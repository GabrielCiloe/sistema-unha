import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json, rateLimit } from "@/lib/server/http";
import { appOrigin, issuePasswordReset, sendResetLink } from "@/lib/server/password-reset";
import { resetLinkSchema } from "@/lib/validation";

// Gera um link de redefinição para um usuário (invalida os anteriores) e o devolve a quem está logada.
// `send: true` também manda o link para o WhatsApp do estúdio. Aqui não há reserva em log: o link já está na tela.
export const POST = handle(async (req, ctx) => {
  const me = await requireUser();
  rateLimit(`reset-link:${me.id}`, 20, 15 * 60_000);
  const { id } = await ctx.params;
  const { send } = resetLinkSchema.parse(await req.json().catch(() => ({})));
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "Usuário não encontrado.");
  const { link, expiresAt } = await issuePasswordReset(user.id, appOrigin(req));
  const whatsappSent = send ? (await sendResetLink({ email: user.email, name: user.name, link }, ["whatsapp"])) === "whatsapp" : false;
  return json({ link, expiresAt, whatsappSent });
});
