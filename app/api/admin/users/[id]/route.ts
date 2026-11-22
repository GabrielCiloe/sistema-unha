import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { emailTaken, userSelect } from "@/lib/server/users";
import { userUpdateSchema } from "@/lib/validation";

const notFound = () => new HttpError(404, "Usuário não encontrado.");

// Edita nome e/ou e-mail (a senha tem fluxo próprio: trocar a própria ou link de redefinição).
export const PATCH = handle(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const data = userUpdateSchema.parse(await req.json());
  const user = await db.user.update({ where: { id }, data, select: userSelect }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw notFound();
    return emailTaken(e);
  });
  return json({ user });
});

// Remove o acesso, com as sessões e os links de redefinição dele. Não remove a si mesmo nem o último usuário.
export const DELETE = handle(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  if (id === me.id) throw new HttpError(400, "Você não pode remover o seu próprio acesso.");
  await db
    .$transaction(
      async (tx) => {
        if (!(await tx.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
        // Serializable: duas remoções simultâneas não deixam o painel sem nenhum usuário.
        if ((await tx.user.count()) <= 1) throw new HttpError(409, "Não é possível remover o último usuário do painel.");
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.passwordReset.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") throw new HttpError(409, "Outra alteração de usuários aconteceu ao mesmo tempo. Tente de novo.");
      throw e;
    });
  return new Response(null, { status: 204 });
});
