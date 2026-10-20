import { createSession, currentUser, destroySession, verifyPassword } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { clientIp, failureGuard, handle, HttpError, json } from "@/lib/server/http";
import { loginSchema } from "@/lib/validation";

// Hash fictício para igualar o tempo de resposta quando o e-mail não existe.
const DUMMY = "00000000000000000000000000000000:" + "0".repeat(128);

export const POST = handle(async (req, ctx) => {
  const { action } = await ctx.params;
  if (action === "logout") {
    await destroySession();
    return json({ ok: true });
  }
  if (action !== "login") throw new HttpError(404, "Não encontrado.");
  const key = `login:${clientIp(req)}`;
  failureGuard.check(key, 8);
  const { email, password } = loginSchema.parse(await req.json());
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY);
  if (!user || !ok) {
    failureGuard.fail(key, 15 * 60_000);
    throw new HttpError(401, "E-mail ou senha incorretos.");
  }
  failureGuard.ok(key);
  await createSession(user.id);
  return json({ ok: true });
});

export const GET = handle(async (_req, ctx) => {
  const { action } = await ctx.params;
  if (action !== "me") throw new HttpError(404, "Não encontrado.");
  return json({ user: await currentUser() });
});
