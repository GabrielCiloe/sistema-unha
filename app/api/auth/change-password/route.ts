import { currentSession, hashPassword, verifyPassword } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { failureGuard, handle, HttpError } from "@/lib/server/http";
import { changePasswordSchema } from "@/lib/validation";

// Troca a própria senha (logada): confere a senha atual, grava a nova e derruba as OUTRAS sessões (mantém a atual).
export const POST = handle(async (req) => {
  const session = await currentSession();
  if (!session) throw new HttpError(401, "Não autenticado.");
  // Mesmo mecanismo do login: 5 senhas atuais erradas em 15 min bloqueiam novas tentativas deste usuário.
  const key = `change-password:${session.user.id}`;
  failureGuard.check(key, 5);
  const { currentPassword, newPassword } = changePasswordSchema.parse(await req.json());
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    failureGuard.fail(key, 15 * 60_000);
    throw new HttpError(400, "Senha atual incorreta.");
  }
  if (currentPassword === newPassword) throw new HttpError(400, "A nova senha precisa ser diferente da atual.");
  failureGuard.ok(key);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } }),
    db.session.deleteMany({ where: { userId: user.id, id: { not: session.sessionId } } }),
    // Links de redefinição pendentes deixam de valer: a senha acabou de ser trocada por quem a conhece.
    db.passwordReset.deleteMany({ where: { userId: user.id } }),
  ]);
  return new Response(null, { status: 204 });
});
