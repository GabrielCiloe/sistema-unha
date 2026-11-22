import { fmtDateTime } from "@/lib/templates";
import { db, getBusiness } from "./db";
import { blockingWhere, HOLD_MINUTES } from "./slots";
import { sendText } from "./whatsapp";

// Prazo do sinal: cada reserva segura a vaga até `holdUntil` (30 min ao agendar; renovado por 30 min a cada recusa).
// Agendamento interno (source ADMIN): `holdUntil` = horário do atendimento (holdUntilFor em lib/booking-math).
// Passado o prazo sem comprovante, a vaga volta para outras clientes e a reserva é expirada com aviso.
const MIN = 60_000;
export const newHold = (from = Date.now()) => new Date(from + HOLD_MINUTES * MIN);

const siteLink = () => (process.env.APP_ORIGIN ? process.env.APP_ORIGIN.replace(/\/+$/, "") : null);

type Appt = { id: string; customerId: string; startsAt: Date; customer: { name: string; phone: string }; items: { name: string }[] };

// Cancela a reserva por falta de comprovante e avisa a cliente (ela responde no WhatsApp do estúdio ou agenda de novo).
export async function expireAppointment(a: Appt, opts: { notify?: boolean } = {}) {
  await db.$transaction([
    db.appointment.update({ where: { id: a.id }, data: { status: "CANCELLED" } }),
    db.payment.updateMany({ where: { appointmentId: a.id, status: { in: ["PENDING", "REJECTED"] } }, data: { status: "EXPIRED" } }),
  ]);
  if (opts.notify === false) return;
  const biz = await getBusiness();
  const first = a.customer.name.split(" ")[0];
  const link = siteLink();
  const text =
    `Olá ${first}, não recebemos o comprovante do sinal e seu horário no ${biz.name} ` +
    `(${a.items.map((i) => i.name).join(" + ")}, ${fmtDateTime(a.startsAt)}) não foi confirmado. A vaga foi liberada.\n` +
    `Se quiser, entre em contato respondendo por aqui` +
    (link ? ` ou faça um novo agendamento: ${link}` : " ou faça um novo agendamento") +
    ".";
  await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id });
}

// Cron: expira as reservas cujo prazo venceu sem comprovante em análise.
export async function expireHolds(max = 20) {
  const due = await db.appointment.findMany({
    where: { status: "PENDING_PAYMENT", holdUntil: { lt: new Date() }, payments: { none: { status: "IN_REVIEW" } } },
    include: { customer: true, items: true },
    orderBy: { holdUntil: "asc" },
    take: max,
  });
  // Agendamento interno que chegou ao horário sem sinal: a vaga é liberada sem mensagem automática à cliente
  // (foi a dona quem marcou e é ela quem trata com a cliente).
  for (const a of due) await expireAppointment(a, { notify: a.source !== "ADMIN" });
  return due.length;
}

// Comprovante chegando depois do prazo: só vale se a vaga ainda estiver livre. Se outra cliente pegou o horário,
// a reserva é expirada e a cliente avisada. Devolve se o comprovante pode ser aceito.
export async function acceptLateProof(a: Appt & { holdUntil: Date; endsAt: Date; status: string }) {
  if (a.holdUntil.getTime() >= Date.now()) return true;
  const biz = await getBusiness();
  const clash = await db.appointment.findFirst({ where: { ...blockingWhere(a.startsAt, a.endsAt, biz.bufferMinutes), id: { not: a.id } }, select: { id: true } });
  if (clash) {
    await expireAppointment(a);
    return false;
  }
  return true;
}

export const LATE_PROOF_MESSAGE = "O prazo para enviar o comprovante acabou e o horário foi ocupado por outra cliente. Faça um novo agendamento.";
