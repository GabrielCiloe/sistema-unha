import { db } from "./db";
import { HttpError } from "./http";
import { blockingWhere, HOLD_MINUTES, leadStart, localToDate, reasonMessage, todayLocal } from "./slots";
import { fromTime, planRanges, rangesForDate } from "@/lib/schedule";
import { normalizePhone, phoneVariants } from "./whatsapp";
import { createDepositPayment } from "./payments";
import { bookingTotals, holdUntilFor } from "@/lib/booking-math";

const TAKEN = "Esse horário acabou de ser ocupado. Escolha outro.";
// Transação Serializable abortada pelo banco (duas reservas disputando o mesmo horário): o Prisma devolve P2034.
export const isWriteConflict = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2034";

// Opções do agendamento interno (painel). Sem elas, valem as regras da página pública.
export type BookingOpts = {
  source?: "PUBLIC" | "ADMIN";
  // A dona pode agendar para hoje: ignora a antecedência mínima em dias (minLeadDays).
  ignoreLead?: boolean;
  // "Horário fora da grade" (HH:MM, hora local): vale no dia de `startsAt` e pode ficar fora do expediente,
  // mas não em dia fechado, nem no passado, nem em conflito com outro atendimento.
  manualTime?: string;
};

export async function createBooking(
  input: {
    serviceIds: string[];
    startsAt: Date;
    name: string;
    phone: string;
    notes?: string;
    missingNails?: Record<string, number>;
  },
  opts: BookingOpts = {},
) {
  const typed = normalizePhone(input.phone);
  if (typed.length < 12 || typed.length > 13) throw new HttpError(400, "Informe um WhatsApp válido com DDD.");
  // Nono dígito: se a cliente já existe com a outra forma do número (com/sem o 9), reaproveita o cadastro em vez de duplicar.
  const known = await db.customer.findFirst({ where: { phone: { in: phoneVariants(typed) } }, select: { phone: true } });
  const phone = known?.phone ?? typed;

  const [biz, services] = await Promise.all([
    db.business.findUnique({ where: { id: "main" } }),
    db.service.findMany({ where: { id: { in: input.serviceIds }, active: true, deletedAt: null } }),
  ]);
  if (!biz) throw new HttpError(503, "Estúdio não configurado.");
  if (services.length === 0 || services.length !== new Set(input.serviceIds).size)
    throw new HttpError(400, "Serviço indisponível.");
  // Dia local do atendimento; com horário manual, a hora digitada substitui a de `startsAt`.
  const dateStr = todayLocal(input.startsAt.getTime());
  const manual = opts.manualTime != null;
  const manualMin = manual ? fromTime(opts.manualTime!) : null;
  if (manual && (manualMin == null || manualMin >= 24 * 60)) throw new HttpError(400, "Horário inválido.");
  const startsAt = manual ? localToDate(dateStr, manualMin!) : input.startsAt;
  if (startsAt.getTime() < Date.now()) throw new HttpError(400, "Horário no passado.");
  // Antecedencia minima em dias (regra do estudio), conferida tambem no servidor.
  if (!opts.ignoreLead && startsAt < leadStart(biz)) throw new HttpError(400, reasonMessage("too_soon", 0, biz));

  // Linhas por serviço (com unhas faltando), total, duração e sinal: contas puras em lib/booking-math.
  const { lines, durationMin, totalCents, depositCents } = bookingTotals(services, biz.depositPercent, input.missingNails);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

  // O horário precisa estar dentro do expediente de um dia de atendimento (não confia só no que a tela ofereceu).
  const override = await db.dayOverride.findUnique({ where: { date: dateStr } });
  const ranges = override ? planRanges(override) : rangesForDate(biz, dateStr);
  if (manual) {
    // Horário fora da grade: só não vale em dia fechado (o expediente do dia não limita a hora).
    if (ranges.length === 0) throw new HttpError(400, "O estúdio está fechado neste dia. Escolha outra data.");
  } else {
    const inside = ranges.some(([o, c]) => startsAt >= localToDate(dateStr, o) && endsAt <= localToDate(dateStr, c));
    if (!inside)
      throw new HttpError(400, "Esse horário está fora do expediente. Escolha outro.");
  }

  // Serializable: duas reservas simultâneas no mesmo horário não passam juntas.
  const source = opts.source ?? "PUBLIC";
  const appt = await db
    .$transaction(
    async (tx) => {
      const clash = await tx.appointment.findFirst({ where: blockingWhere(startsAt, endsAt, biz.bufferMinutes), select: { id: true } });
      if (clash) throw new HttpError(409, TAKEN);
      const customer = await tx.customer.upsert({
        where: { phone },
        update: { name: input.name },
        create: { name: input.name, phone },
      });
      return tx.appointment.create({
        data: {
          customerId: customer.phone,
          startsAt,
          endsAt,
          // Pública: 30 min para o sinal. Interna: a vaga fica bloqueada até o horário do atendimento.
          holdUntil: holdUntilFor(source, startsAt, Date.now(), HOLD_MINUTES),
          source,
          totalCents,
          depositCents,
          notes: input.notes ?? "",
          items: {
            create: lines.map((l) => ({
              serviceId: l.s.id,
              name: l.name,
              priceCents: l.priceCents,
              durationMin: l.s.durationMin,
              missingNails: l.missing,
              missingNailPriceCents: l.missing > 0 ? l.s.missingNailPriceCents : 0,
            })),
          },
        },
        include: { customer: true, items: true },
      });
    },
    { isolationLevel: "Serializable" },
    )
    .catch((e) => {
      // Quem perde a disputa pelo horário recebe o mesmo 409 de "ocupado", não um erro interno.
      if (isWriteConflict(e)) throw new HttpError(409, TAKEN);
      throw e;
    });

  try {
    const payment = await createDepositPayment(appt);
    return { appt, payment };
  } catch (e) {
    await db.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } });
    throw e;
  }
}
