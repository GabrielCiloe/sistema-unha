// Usuários do painel: o que pode sair numa resposta (nunca passwordHash nem tokenHash).
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";

export const userSelect = { id: true, name: true, email: true, createdAt: true } as const;

// "Última sessão" = login mais recente ainda registrado em Session (o model não muda).
// Sessões apagadas (sair, troca de senha) não contam; sem nenhuma, vem null.
export async function listUsers() {
  const [users, last] = await Promise.all([
    db.user.findMany({ select: userSelect, orderBy: { createdAt: "asc" } }),
    db.session.groupBy({ by: ["userId"], _max: { createdAt: true } }),
  ]);
  const map = new Map(last.map((l) => [l.userId, l._max.createdAt]));
  return users.map((u) => ({ ...u, lastSessionAt: map.get(u.id) ?? null }));
}

// E-mail já usado por outro acesso → 409 com mensagem amigável.
export function emailTaken(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "Já existe um usuário com este e-mail.");
  throw e;
}
