import { clientIp, handle, rateLimit } from "@/lib/server/http";
import { resetPasswordWithToken } from "@/lib/server/password-reset";
import { resetPasswordSchema } from "@/lib/validation";

// Redefine a senha com o token do link (uso único, 30 min) e derruba todas as sessões do usuário.
export const POST = handle(async (req) => {
  rateLimit(`reset:${clientIp(req)}`, 5, 15 * 60_000);
  const { token, password } = resetPasswordSchema.parse(await req.json());
  await resetPasswordWithToken(token, password);
  return new Response(null, { status: 204 });
});
