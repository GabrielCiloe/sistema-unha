import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { serviceSchema } from "@/lib/validation";

export const GET = handle(async () => {
  await requireUser();
  return json({ services: await db.service.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }) });
});

export const POST = handle(async (req) => {
  await requireUser();
  const service = await db.service.create({ data: serviceSchema.parse(await req.json()) });
  return json({ service }, 201);
});
