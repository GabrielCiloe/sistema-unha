import { after } from "next/server";
import { db } from "@/lib/server/db";
import { clientIp, handle, rateLimit } from "@/lib/server/http";
import { appOrigin, issuePasswordReset, sendResetLink } from "@/lib/server/password-reset";
import { forgotPasswordSchema } from "@/lib/validation";

// "Esqueci minha senha": responde SEMPRE 204, exista ou não o e-mail.
// Todo o trabalho que depende do e-mail (consulta, token, envio pelo WhatsApp) roda depois da resposta (after),
// então nem o corpo nem o tempo de resposta mostram se o e-mail tem acesso ao painel.
export const POST = handle(async (req) => {
  rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60_000);
  const { email } = forgotPasswordSchema.parse(await req.json());
  const origin = appOrigin(req);
  after(async () => {
    try {
      const user = await db.user.findUnique({ where: { email } });
      if (!user) return;
      const { link } = await issuePasswordReset(user.id, origin);
      await sendResetLink({ email: user.email, name: user.name, link });
    } catch (e) {
      console.error("[senha] Falha ao gerar o link de redefinição.", e instanceof Error ? e.message : "");
    }
  });
  return new Response(null, { status: 204 });
});
