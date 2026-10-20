import { timingSafeEqual } from "node:crypto";
import { db, getBusiness } from "@/lib/server/db";
import { settlePastAppointments } from "@/lib/server/appointments";
import { handle, HttpError, json } from "@/lib/server/http";
import { HOLD_MINUTES } from "@/lib/server/slots";
import { runReturnInvites } from "@/lib/server/returns";
import { sendText } from "@/lib/server/whatsapp";
import { renderTemplate } from "@/lib/templates";

// Agendado pela Vercel Cron (vercel.json) ou por qualquer cron externo com
// "Authorization: Bearer $CRON_SECRET". Envia lembretes e libera reservas sem pagamento.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // os convites de retorno têm pausas aleatórias entre os envios

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const GET = handle(async (req) => {
  if (!authorized(req)) throw new HttpError(401, "Não autorizado.");
  const biz = await getBusiness();
  const now = new Date();
  const completed = await settlePastAppointments();

  const expired = await db.appointment.updateMany({
    where: {
      status: "PENDING_PAYMENT",
      createdAt: { lt: new Date(now.getTime() - HOLD_MINUTES * 60_000) },
      payments: { none: { status: "IN_REVIEW" } },
    },
    data: { status: "CANCELLED" },
  });

  const due = await db.appointment.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date(now.getTime() + biz.reminderHours * 3600_000) },
    },
    include: { customer: true, items: true },
    take: 50,
  });
  let sent = 0;
  for (const a of due) {
    const text = renderTemplate(biz.reminderTemplate, {
      cliente: a.customer.name,
      negocio: biz.name,
      servico: a.items.map((i) => i.name).join(" + "),
      startsAt: a.startsAt,
    });
    // Marca antes de enviar a próxima: falha de envio fica no histórico, sem reenviar em loop.
    await db.appointment.update({ where: { id: a.id }, data: { reminderSentAt: new Date() } });
    if (await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id })) sent++;
  }
  const returns = await runReturnInvites(biz);
  return json({ completed, expired: expired.count, reminders: sent, due: due.length, returns });
});
