import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";

// Ajustes por data (Configurações > calendário): um dia específico com horários próprios ou fechado.
// Sem ajuste, vale a grade semanal. `plan: null` apaga o ajuste e o dia volta ao padrão da semana.
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const planSchema = z
  .object({
    on: z.boolean(),
    open: z.number().int().min(0).max(1439),
    lunchStart: z.number().int().min(0).max(1440).nullable(),
    lunchEnd: z.number().int().min(0).max(1440).nullable(),
    close: z.number().int().min(1).max(1440),
  })
  .refine((d) => !d.on || d.close > d.open, "Fechamento deve ser depois da abertura");
const bodySchema = z.object({ date: z.string().regex(DATE), plan: planSchema.nullable(), week: z.boolean().optional() });

const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const GET = handle(async (req) => {
  await requireUser();
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) throw new HttpError(400, "Período inválido.");
  const overrides = await db.dayOverride.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: "asc" } });
  return json({ overrides });
});

export const PUT = handle(async (req) => {
  await requireUser();
  const { date, plan, week } = bodySchema.parse(await req.json());
  // Semana inteira: domingo a sábado da semana da data.
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dates = week ? Array.from({ length: 7 }, (_, i) => addDays(date, i - dow)) : [date];
  if (plan === null) {
    await db.dayOverride.deleteMany({ where: { date: { in: dates } } });
  } else {
    await db.$transaction(dates.map((dt) => db.dayOverride.upsert({ where: { date: dt }, update: plan, create: { date: dt, ...plan } })));
  }
  return json({ ok: true, dates });
});
