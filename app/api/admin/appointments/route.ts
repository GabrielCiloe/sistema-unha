import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { settlePastAppointments } from "@/lib/server/appointments";
import { handle, HttpError, json } from "@/lib/server/http";
import { createBooking } from "@/lib/server/bookings";
import { confirmPayment, sendPixMessage } from "@/lib/server/payments";
import { adminBookingSchema } from "@/lib/validation";

export const GET = handle(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 7 * 86400_000);
  const to = new Date(url.searchParams.get("to") ?? Date.now() + 60 * 86400_000);
  if (isNaN(+from) || isNaN(+to)) throw new HttpError(400, "Período inválido.");
  await settlePastAppointments();
  const status = url.searchParams.get("status");
  const appointments = await db.appointment.findMany({
    where: { startsAt: { gte: from, lte: to }, ...(status ? { status: status as never } : {}) },
    orderBy: { startsAt: "asc" },
    take: 500,
    include: {
      customer: true,
      items: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true, status: true, amountCents: true, paidAt: true,
          rejectReason: true, proofMime: true,
        },
      },
    },
  });
  return json({ appointments });
});

// Agendamento interno (Agenda > Novo agendamento): mesma reserva da página pública (createBooking), com origem ADMIN.
// A dona pode agendar para hoje e digitar um horário fora da grade; conflito, dia fechado e passado continuam barrados.
export const POST = handle(async (req) => {
  await requireUser();
  const { allowToday, manualTime, markDepositPaid, sendPix, ...body } = adminBookingSchema.parse(await req.json());
  const { appt, payment } = await createBooking(
    { ...body, startsAt: new Date(body.startsAt) },
    { source: "ADMIN", ignoreLead: allowToday, manualTime },
  );

  let whatsappSent = false;
  if (markDepositPaid) {
    // Sinal recebido em mãos: mesmo caminho da aprovação do comprovante (confirma e manda a confirmação à cliente).
    await confirmPayment(payment.id);
    whatsappSent = Boolean(
      await db.messageLog.findFirst({ where: { appointmentId: appt.id, direction: "OUT", status: "SENT" }, select: { id: true } }),
    );
  } else if (sendPix) {
    whatsappSent = await sendPixMessage(appt.id);
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appt.id },
    include: {
      customer: true,
      items: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, amountCents: true, paidAt: true, rejectReason: true, proofMime: true },
      },
    },
  });
  return json({ appointment, payment: { id: payment.id, amountCents: payment.amountCents, pixPayload: payment.pixPayload }, whatsappSent }, 201);
});
