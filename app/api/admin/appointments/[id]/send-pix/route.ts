import { requireUser } from "@/lib/server/auth";
import { handle, json } from "@/lib/server/http";
import { sendPixMessage } from "@/lib/server/payments";

// Agenda > agendamento interno > "Enviar pelo WhatsApp": manda (ou reenvia) à cliente a reserva + o Pix copia e cola.
// WhatsApp desconectado não é erro: responde 200 com whatsappSent = false e a tentativa fica no histórico de mensagens.
export const POST = handle(async (_req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return json({ whatsappSent: await sendPixMessage(id) });
});
