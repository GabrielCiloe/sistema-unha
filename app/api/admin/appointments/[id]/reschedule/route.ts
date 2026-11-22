import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { addDays, availabilityForDays, availableSlots, HOLD_MINUTES, reasonMessage, todayLocal } from "@/lib/server/slots";
import { holdUntilFor } from "@/lib/booking-math";
import { sendText } from "@/lib/server/whatsapp";
import { DEFAULT_RESCHEDULE_TEMPLATE } from "@/lib/defaults";
import { mapsUrl, renderTemplate } from "@/lib/templates";

// Reagendamento pelo estúdio (Agenda > Reagendar): mantém serviços, valores e o sinal pago; muda só data e hora.
// Usa a duração dos serviços contratados, sem a antecedência mínima em dias (quem remarca é a dona).
export const dynamic = "force-dynamic";
const DAYS = 60;

async function load(id: string) {
  const a = await db.appointment.findUnique({ where: { id }, include: { customer: true, items: true } });
  if (!a) throw new HttpError(404, "Agendamento não encontrado.");
  if (!["PENDING_PAYMENT", "CONFIRMED"].includes(a.status)) throw new HttpError(409, "Só agendamentos aguardando sinal ou confirmados podem ser remarcados.");
  const duration = a.items.reduce((s, i) => s + i.durationMin, 0) || Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
  return { a, duration };
}

// ?date=AAAA-MM-DD → horários livres do dia; sem date → disponibilidade dos próximos dias (calendário).
export const GET = handle(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const { a, duration } = await load(id);
  const opts = { ignoreLead: true, excludeId: a.id };
  const date = new URL(req.url).searchParams.get("date");
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Data inválida.");
    const { slots, reason } = await availableSlots(date, duration, opts);
    const biz = await getBusiness();
    return json({ slots, durationMin: duration, message: reason ? reasonMessage(reason, duration, { ...biz, minLeadDays: 0 }) : null });
  }
  const today = todayLocal(Date.now());
  const { biz, days } = await availabilityForDays(Array.from({ length: DAYS }, (_, i) => addDays(today, i)), duration, opts);
  return json({
    durationMin: duration,
    days: days.map((d) => ({ date: d.date, available: d.count > 0, reason: d.reason, message: d.reason && biz ? reasonMessage(d.reason, duration, biz) : null })),
  });
});

const schema = z.object({ startsAt: z.string().datetime() });

export const POST = handle(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const { a, duration } = await load(id);
  const { startsAt } = schema.parse(await req.json());
  const start = new Date(startsAt);
  const date = todayLocal(start.getTime());
  const { slots } = await availableSlots(date, duration, { ignoreLead: true, excludeId: a.id });
  if (!slots.includes(start.toISOString())) throw new HttpError(409, "Esse horário não está mais livre. Escolha outro.");

  const end = new Date(start.getTime() + duration * 60_000);
  // Lembrete volta a ser planejado para a nova data.
  // Agendamento interno ainda sem sinal: o prazo da vaga acompanha o novo horário (holdUntil = horário do atendimento).
  // Sem isto ele ficaria no horário antigo: a vaga nova deixaria de ser bloqueada e o cron cancelaria a reserva antes
  // do atendimento. Reserva da cliente (PUBLIC) não muda: o prazo de 30 min do sinal continua o mesmo.
  const hold = a.source === "ADMIN" && a.status === "PENDING_PAYMENT" ? { holdUntil: holdUntilFor("ADMIN", start, Date.now(), HOLD_MINUTES) } : {};
  await db.appointment.update({ where: { id }, data: { startsAt: start, endsAt: end, reminderDueAt: null, reminderSentAt: null, ...hold } });

  const biz = await getBusiness();
  const text = renderTemplate(biz.rescheduleTemplate.trim() || DEFAULT_RESCHEDULE_TEMPLATE, {
    cliente: a.customer.name,
    negocio: biz.name,
    servico: a.items.map((i) => i.name).join(" + "),
    startsAt: start,
    endereco: biz.address,
    mapa: mapsUrl(biz),
  });
  const sent = await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id });
  return json({ ok: true, startsAt: start, endsAt: end, sent });
});
