import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { businessSchema } from "@/lib/validation";

export const GET = handle(async () => {
  await requireUser();
  return json({
    business: await getBusiness(),
    env: { whatsapp: Boolean(process.env.WA_AKG_URL && process.env.WA_AKG_API_KEY) },
  });
});

export const PUT = handle(async (req) => {
  await requireUser();
  const data = businessSchema.parse(await req.json());
  const business = await db.business.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
  return json({ business });
});
