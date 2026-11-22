import { Prisma } from "@prisma/client";
import { buildPixPayload } from "@/lib/pix";
import { brl, fmtDateTime, mapsUrl, renderTemplate } from "@/lib/templates";
import { db, getBusiness } from "./db";
import { HOLD_MINUTES } from "./slots";
import { HttpError } from "./http";
import { sendText } from "./whatsapp";
import { acceptLateProof, newHold } from "./holds";

const fmtTime = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(d);

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
    endereco: biz.address,
    mapa: mapsUrl(biz),
  });
  await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id });
}

// Agendamento interno: manda à cliente a reserva + o Pix copia e cola do sinal (o código vai numa mensagem só dele,
// para ser copiado com um toque). Devolve se o WhatsApp entregou; desconectado não é erro, só `false`.
export async function sendPixMessage(appointmentId: string) {
  const [biz, a] = await Promise.all([
    getBusiness(),
    db.appointment.findUnique({
      where: { id: appointmentId },
      include: { customer: true, items: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);
  if (!a) throw new HttpError(404, "Agendamento não encontrado.");
  const p = a.payments[0];
  if (p?.status === "PAID") throw new HttpError(409, "O sinal deste agendamento já foi pago.");
  if (a.status !== "PENDING_PAYMENT" || !p?.pixPayload || !["PENDING", "REJECTED"].includes(p.status))
    throw new HttpError(409, "Este agendamento não está aguardando o sinal.");
  const first = a.customer.name.split(" ")[0];
  const link = process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN.replace(/\/+$/, "")}/reserva/${a.publicToken}` : null;
  const text =
    `Olá ${first}! Seu horário no ${biz.name} está reservado:
` +
    `${a.items.map((i) => i.name).join(" + ")}
` +
    `${fmtDateTime(a.startsAt)}
` +
    `Total: ${brl(a.totalCents)}

` +
    `Para confirmar, pague o sinal de ${brl(p.amountCents)} por Pix com o código copia e cola da próxima mensagem ` +
    `e envie o comprovante por aqui` + (link ? ` ou pelo link: ${link}` : "") + `.
` +
    (a.holdUntil.getTime() > Date.now() ? `A vaga fica reservada até ${fmtTime(a.holdUntil)}.` : "");
  const ids = { customerId: a.customerId, appointmentId: a.id };
  const sent = await sendText(a.customer.phone, text.trim(), ids);
  // Sem conexão, não insiste na segunda mensagem (ficaria só mais um registro de falha no histórico).
  return sent ? sendText(a.customer.phone, p.pixPayload, ids) : false;
}

// Comprovante enviado pelo WhatsApp: vincula à reserva pendente mais recente da cliente (mesmo efeito do botão "Enviar comprovante").
// Devolve o que aconteceu para o webhook responder à cliente.
export async function attachProofFromWhatsApp(phone: string, proof: Buffer, mime: "image/png" | "image/jpeg" | "application/pdf") {
  const appt = await db.appointment.findFirst({
    where: { customerId: phone, status: "PENDING_PAYMENT", payments: { some: { status: { in: ["PENDING", "REJECTED"] } } } },
    orderBy: { createdAt: "desc" },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 }, items: true, customer: true },
  });
  const p = appt?.payments[0];
  if (!appt || !p || !["PENDING", "REJECTED"].includes(p.status)) return { attached: false as const, expired: false };
  if (!(await acceptLateProof(appt))) return { attached: false as const, expired: true };
  await db.payment.update({ where: { id: p.id }, data: { status: "IN_REVIEW", proofData: new Uint8Array(proof), proofMime: mime, rejectReason: null } });
  return { attached: true as const, appointmentId: appt.id, service: appt.items.map((i) => i.name).join(" + "), startsAt: appt.startsAt, ackSent: Boolean(appt.proofAckSentAt) };
}

export async function rejectPayment(paymentId: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new HttpError(404, "Pagamento não encontrado.");
  if (p.status === "PAID") throw new HttpError(409, "Pagamento já aprovado.");
  // A recusa dá à cliente um novo prazo de 30 min para enviar outro comprovante (a vaga segue reservada até lá).
  const hold = newHold();
  await db.$transaction([
    db.payment.update({ where: { id: p.id }, data: { status: "REJECTED", rejectReason: reason, reviewedAt: new Date(), proofData: null } }),
    db.appointment.update({ where: { id: p.appointmentId }, data: { holdUntil: hold } }),
  ]);
  // Avisa a cliente no WhatsApp com o motivo e o link para reenviar. Falha de envio fica só no histórico.
  const [biz, a] = await Promise.all([
    getBusiness(),
    db.appointment.findUnique({ where: { id: p.appointmentId }, include: { customer: true, items: true } }),
  ]);
  if (!a) return;
  const first = a.customer.name.split(" ")[0];
  const link = process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN.replace(/\/+$/, "")}/reserva/${a.publicToken}` : null;
  const text =
    `Oi ${first}, não conseguimos aprovar o comprovante do sinal do seu horário no ${biz.name} ` +
    `(${a.items.map((i) => i.name).join(" + ")}, ${fmtDateTime(a.startsAt)}).
` +
    `Motivo: ${reason}
` +
    `Pode enviar outro comprovante por aqui mesmo` + (link ? ` ou pelo link: ${link}` : "") + `.\n` +
    `Sua vaga fica reservada por mais ${HOLD_MINUTES} minutos (até ${fmtTime(hold)}). Depois disso ela é liberada para outras clientes.`;
  await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id });
}
