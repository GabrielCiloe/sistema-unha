import { db } from "./db";
import { HttpError } from "./http";
import { blockingWhere, leadStart, localToDate, reasonMessage } from "./slots";
import { planRanges, rangesForDate } from "@/lib/schedule";
import { normalizePhone, phoneVariants } from "./whatsapp";
import { createDepositPayment } from "./payments";
import { newHold } from "./holds";

export async function createBooking(input: {
  serviceIds: string[];
  startsAt: Date;
  name: string;
  phone: string;
  notes?: string;
  missingNails?: Record<string, number>;
}) {
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
  if (input.startsAt.getTime() < Date.now()) throw new HttpError(400, "Horário no passado.");
  // Antecedencia minima em dias (regra do estudio), conferida tambem no servidor.
  if (input.startsAt < leadStart(biz)) throw new HttpError(400, reasonMessage("too_soon", 0, biz));

  // Manutencao: cada unha faltando soma o preco por unha do servico ao total (e, por consequencia, ao sinal).
  const lines = services.map((s) => {
    const missing = s.missingNailPriceCents > 0 ? Math.max(0, Math.min(10, Math.floor(input.missingNails?.[s.id] ?? 0))) : 0;
    const extra = missing * s.missingNailPriceCents;
    return { s, missing, priceCents: s.priceCents + extra, name: missing > 0 ? `${s.name} (${missing} ${missing === 1 ? "unha faltando" : "unhas faltando"})` : s.name };
  });
  const durationMin = services.reduce((s, x) => s + x.durationMin, 0);
  const totalCents = lines.reduce((s, x) => s + x.priceCents, 0);
  const depositCents = Math.max(1, Math.round((totalCents * biz.depositPercent) / 100));
  const endsAt = new Date(input.startsAt.getTime() + durationMin * 60_000);

  // O horário precisa estar dentro do expediente de um dia de atendimento (não confia só no que a tela ofereceu).
  const dateStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(input.startsAt);
  const override = await db.dayOverride.findUnique({ where: { date: dateStr } });
  const ranges = override ? planRanges(override) : rangesForDate(biz, dateStr);
  const inside = ranges.some(([o, c]) => input.startsAt >= localToDate(dateStr, o) && endsAt <= localToDate(dateStr, c));
  if (!inside)
    throw new HttpError(400, "Esse horário está fora do expediente. Escolha outro.");

  // Serializable: duas reservas simultâneas no mesmo horário não passam juntas.
  const appt = await db.$transaction(
    async (tx) => {
      const clash = await tx.appointment.findFirst({ where: blockingWhere(input.startsAt, endsAt, biz.bufferMinutes), select: { id: true } });
      if (clash) throw new HttpError(409, "Esse horário acabou de ser ocupado. Escolha outro.");
      const customer = await tx.customer.upsert({
        where: { phone },
        update: { name: input.name },
        create: { name: input.name, phone },
      });
      return tx.appointment.create({
        data: {
          customerId: customer.phone,
          startsAt: input.startsAt,
          endsAt,
          holdUntil: newHold(),
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
  );

  try {
    const payment = await createDepositPayment(appt);
    return { appt, payment };
  } catch (e) {
    await db.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } });
    throw e;
  }
}
