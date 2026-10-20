import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { z } from "zod";
import { handle, HttpError, json } from "@/lib/server/http";
import { normalizePhone } from "@/lib/server/whatsapp";

export const GET = handle(async (req) => {
  await requireUser();
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const customers = await db.customer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || "x" } }] } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      _count: { select: { appointments: true } },
      appointments: { orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true, status: true } },
    },
  });
  return json({ customers });
});

const customerSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  notes: z.string().trim().max(500).default(""),
});

// Cria a cliente a partir do número (ex.: de uma conversa do WhatsApp) ou atualiza nome/observações se já existir.
export const POST = handle(async (req) => {
  await requireUser();
  const body = customerSchema.parse(await req.json());
  const phone = normalizePhone(body.phone);
  if (phone.length < 12 || phone.length > 13) throw new HttpError(400, "Informe um WhatsApp válido com DDD.");
  const customer = await db.customer.upsert({
    where: { phone },
    update: { name: body.name, notes: body.notes },
    create: { phone, name: body.name, notes: body.notes },
  });
  return json({ customer }, 201);
});
