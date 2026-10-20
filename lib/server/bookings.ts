import { db } from "./db";
import { HttpError } from "./http";
import { blockingWhere, localToDate, weekdayOf } from "./slots";
import { normalizePhone } from "./whatsapp";
import { createDepositPayment } from "./payments";

export async function createBooking(input: {
  serviceIds: string[];
  startsAt: Date;
  name: string;
  phone: string;
  notes?: string;
}) {
  const phone = normalizePhone(input.phone);
  if (phone.length < 12 || phone.length > 13) throw new HttpError(400, "Informe um WhatsApp válido com DDD.");

  const [biz, services] = await Promise.all([
    db.business.findUnique({ where: { id: "main" } }),
    db.service.findMany({ where: { id: { in: input.serviceIds }, active: true, deletedAt: null } }),
  ]);
  if (!biz) throw new HttpError(503, "Estúdio não configurado.");
  if (services.length === 0 || services.length !== new Set(input.serviceIds).size)
    throw new HttpError(400, "Serviço indisponível.");
  if (input.startsAt.getTime() < Date.now()) throw new HttpError(400, "Horário no passado.");

  const durationMin = services.reduce((s, x) => s + x.durationMin, 0);
  const totalCents = services.reduce((s, x) => s + x.priceCents, 0);
  const depositCents = Math.max(1, Math.round((totalCents * biz.depositPercent) / 100));
  const endsAt = new Date(input.startsAt.getTime() + durationMin * 60_000);

  // O horário precisa estar dentro do expediente de um dia de atendimento (não confia só no que a tela ofereceu).
  const dateStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(input.startsAt);
  if (
    !biz.workDays.includes(weekdayOf(dateStr)) ||
    input.startsAt < localToDate(dateStr, biz.openMinutes) ||
    endsAt > localToDate(dateStr, biz.closeMinutes)
  )
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
          totalCents,
          depositCents,
          notes: input.notes ?? "",
          items: {
            create: services.map((s) => ({
              serviceId: s.id,
              name: s.name,
              priceCents: s.priceCents,
              durationMin: s.durationMin,
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
