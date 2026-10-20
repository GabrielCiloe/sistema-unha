import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { sendText } from "@/lib/server/whatsapp";

// O gestor só decide dois desfechos: cancelar, ou registrar que a cliente faltou.
// "Concluído" é automático (confirmado + data passada), por isso não é aceito aqui.
const schema = z.object({ status: z.enum(["CANCELLED", "NO_SHOW"]) });

export const PATCH = handle(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const { status } = schema.parse(await req.json());
  const a = await db.appointment.findUnique({ where: { id }, include: { customer: true, payments: { select: { status: true } } } });
  if (!a) throw new HttpError(404, "Agendamento não encontrado.");

  if (status === "CANCELLED") {
    if (!["PENDING_PAYMENT", "CONFIRMED"].includes(a.status)) throw new HttpError(409, "Só é possível cancelar agendamentos aguardando sinal ou confirmados.");
  } else {
    if (!["CONFIRMED", "COMPLETED"].includes(a.status)) throw new HttpError(409, "Só agendamentos confirmados podem receber falta.");
    if (a.startsAt > new Date()) throw new HttpError(409, "O horário ainda não começou.");
  }

  await db.appointment.update({ where: { id }, data: { status } });

  if (status === "CANCELLED") {
    const biz = await getBusiness();
    const paid = a.payments.some((p) => p.status === "PAID");
    const first = a.customer.name.split(" ")[0];
    const text = paid
      ? `Olá ${first}, seu horário no ${biz.name} foi cancelado. Vamos combinar com você a devolução do sinal pago. Se quiser, agende outro pelo nosso link.`
      : `Olá ${first}, seu horário no ${biz.name} foi cancelado. Se quiser, agende outro pelo nosso link.`;
    await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id });
  }
  return json({ ok: true });
});
