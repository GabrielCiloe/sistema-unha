import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { normalizePhone, sendText } from "@/lib/server/whatsapp";

// Sem ?phone: lista de conversas (agrupadas por telefone). Com ?phone: mensagens da conversa.
export const GET = handle(async (req) => {
  await requireUser();
  const phone = new URL(req.url).searchParams.get("phone");

  if (phone) {
    const p = normalizePhone(phone);
    const [messages, customer] = await Promise.all([
      db.messageLog.findMany({ where: { phone: p }, orderBy: { createdAt: "asc" }, take: 300 }),
      db.customer.findUnique({ where: { phone: p }, select: { name: true, notes: true } }),
    ]);
    return json({ phone: p, name: customer?.name ?? null, notes: customer?.notes ?? "", messages });
  }

  const recent = await db.messageLog.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
  const byPhone = new Map<string, { phone: string; last: (typeof recent)[number]; count: number }>();
  for (const m of recent) {
    const c = byPhone.get(m.phone);
    if (c) c.count++;
    else byPhone.set(m.phone, { phone: m.phone, last: m, count: 1 });
  }
  const phones = [...byPhone.keys()];
  const customers = await db.customer.findMany({ where: { phone: { in: phones } }, select: { phone: true, name: true } });
  const names = new Map(customers.map((c) => [c.phone, c.name]));
  return json({
    conversations: [...byPhone.values()].map((c) => ({
      phone: c.phone,
      name: names.get(c.phone) ?? null,
      lastBody: c.last.body,
      lastDirection: c.last.direction,
      lastStatus: c.last.status,
      lastAt: c.last.createdAt,
      count: c.count,
    })),
  });
});

const sendSchema = z.object({ phone: z.string().trim().min(8).max(20), text: z.string().trim().min(1).max(2000) });

export const POST = handle(async (req) => {
  await requireUser();
  const { phone, text } = sendSchema.parse(await req.json());
  const customer = await db.customer.findUnique({ where: { phone: normalizePhone(phone) }, select: { phone: true } });
  const ok = await sendText(phone, text, { customerId: customer?.phone });
  if (!ok) throw new HttpError(502, "Não foi possível enviar. Veja se o WhatsApp está conectado em WhatsApp.");
  return json({ ok: true });
});
