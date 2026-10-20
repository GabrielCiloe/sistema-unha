import { Prisma } from "@prisma/client";
import { buildPixPayload } from "@/lib/pix";
import { renderTemplate } from "@/lib/templates";
import { db, getBusiness } from "./db";
import { HttpError } from "./http";
import { sendText } from "./whatsapp";

type ApptWithCustomer = Prisma.AppointmentGetPayload<{ include: { customer: true; items: true } }>;

// Cria a cobrança do sinal: Pix estático (copia e cola/QR). A confirmação é manual, por comprovante.
export async function createDepositPayment(appt: ApptWithCustomer) {
  const biz = await getBusiness();
  if (appt.depositCents <= 0) throw new HttpError(400, "Sinal inválido.");

  if (!biz.pixKey) throw new HttpError(503, "Chave Pix do estúdio não configurada.");
  return db.payment.create({
    data: {
      appointmentId: appt.id,
      amountCents: appt.depositCents,
      pixPayload: buildPixPayload({
        key: biz.pixKey,
        name: biz.pixName || biz.name,
        city: biz.pixCity,
        amount: appt.depositCents / 100,
        txid: appt.id,
      }),
    },
  });
}

// Marca o pagamento como pago e confirma o agendamento (idempotente).
export async function confirmPayment(paymentId: string) {
  const confirmed = await db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new HttpError(404, "Pagamento não encontrado.");
    if (p.status === "PAID") return false;
    await tx.payment.update({ where: { id: p.id }, data: { status: "PAID", paidAt: new Date(), reviewedAt: new Date() } });
    await tx.appointment.update({ where: { id: p.appointmentId }, data: { status: "CONFIRMED" } });
    return p.appointmentId;
  });
  if (confirmed) await sendConfirmation(confirmed);
  return Boolean(confirmed);
}

export async function sendConfirmation(appointmentId: string) {
  const [biz, a] = await Promise.all([
    getBusiness(),
    db.appointment.findUnique({ where: { id: appointmentId }, include: { customer: true, items: true } }),
  ]);
  if (!a) return;
  const text = renderTemplate(biz.confirmationTemplate, {
    cliente: a.customer.name,
    negocio: biz.name,
    servico: a.items.map((i) => i.name).join(" + "),
    startsAt: a.startsAt,
  });
  await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id });
}

export async function rejectPayment(paymentId: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new HttpError(404, "Pagamento não encontrado.");
  if (p.status === "PAID") throw new HttpError(409, "Pagamento já aprovado.");
  await db.payment.update({
    where: { id: p.id },
    data: { status: "REJECTED", rejectReason: reason, reviewedAt: new Date(), proofData: null },
  });
}
