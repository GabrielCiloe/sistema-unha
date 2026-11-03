import { timingSafeEqual } from "node:crypto";
import { db, getBusiness } from "@/lib/server/db";
import { settlePastAppointments } from "@/lib/server/appointments";
import { handle, HttpError, json } from "@/lib/server/http";
import { expireHolds } from "@/lib/server/holds";
import { runReturnInvites } from "@/lib/server/returns";
import { runReminders } from "@/lib/server/reminders";

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
  const completed = await settlePastAppointments();

  // Reservas cujo prazo do sinal venceu sem comprovante: cancela e avisa a cliente (lib/server/holds.ts).
  const expired = await expireHolds();

  // Lembretes espalhados e aleatórios (lib/server/reminders.ts): horário sorteado por agendamento, poucos por execução.
  const reminders = await runReminders(biz);
  const returns = await runReturnInvites(biz);
  return json({ completed, expired, reminders, returns });
});
