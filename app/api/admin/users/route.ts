import { hashPassword, requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { generatePassword } from "@/lib/server/password-reset";
import { emailTaken, listUsers, userSelect } from "@/lib/server/users";
import { userCreateSchema } from "@/lib/validation";

export const GET = handle(async () => {
  const me = await requireUser();
  return json({ users: await listUsers(), currentUserId: me.id });
});

// Cria o acesso com uma senha inicial gerada aqui. Ela volta nesta resposta e nunca mais (só o hash é guardado).
export const POST = handle(async (req) => {
  await requireUser();
  const data = userCreateSchema.parse(await req.json());
  const password = generatePassword();
  const user = await db.user.create({ data: { ...data, passwordHash: hashPassword(password) }, select: userSelect }).catch(emailTaken);
  return json({ user: { ...user, lastSessionAt: null }, password }, 201);
});
