import { after } from "next/server";
import { clientIp, handle, rateLimit } from "@/lib/server/http";
import { publicAppOrigin, requestPasswordReset } from "@/lib/server/password-reset";
import { forgotPasswordSchema } from "@/lib/validation";

// "Esqueci minha senha": responde SEMPRE 204, exista ou não o e-mail.
// Todo o trabalho que depende do e-mail (limite por e-mail, consulta, token, envio pelo WhatsApp) roda depois da
// resposta (after), então nem o corpo nem o tempo de resposta mostram se o e-mail tem acesso ao painel.
export const POST = handle(async (req) => {
  rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60_000);
  const { email } = forgotPasswordSchema.parse(await req.json());
  // Em produção sem APP_ORIGIN vem null: nenhum link é montado com o Host da requisição (só um erro de configuração no log).
  const origin = publicAppOrigin(req);
  after(async () => {
    try {
      await requestPasswordReset(email, origin);
    } catch (e) {
      console.error("[senha] Falha ao gerar o link de redefinição.", e instanceof Error ? e.message : "");
    }
  });
  return new Response(null, { status: 204 });
});
