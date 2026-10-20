import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { serviceSchema } from "@/lib/validation";

export const PUT = handle(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const data = serviceSchema.parse(await req.json());
  const r = await db.service.updateMany({ where: { id, deletedAt: null }, data });
  if (!r.count) throw new HttpError(404, "Serviço não encontrado.");
  return json({ ok: true });
});

// Exclusão lógica: agendamentos antigos mantêm nome/preço históricos.
export const DELETE = handle(async (_req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  await db.service.updateMany({ where: { id }, data: { deletedAt: new Date(), active: false } });
  return json({ ok: true });
});
