import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { z } from "zod";
import { handle, HttpError, json } from "@/lib/server/http";
import { normalizePhone } from "@/lib/server/whatsapp";

export const GET = handle(async (req) => {
  await requireUser();
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim();
  // ?autocomplete=1 (popup "Novo agendamento"): telefone por PREFIXO (só dígitos, com ou sem o DDI 55) ou trecho do nome,
  // até 8 resultados. Sem o parâmetro, a busca da tela Clientes segue como sempre foi (telefone por trecho, até 200).
  const auto = params.get("autocomplete") === "1";
  if (auto && !q) return json({ customers: [] });
  const digits = q?.replace(/\D/g, "") ?? "";
  // No autocomplete, só o que foi digitado como telefone (dígitos e máscara) procura por telefone.
  const phoneLike = digits.length > 0 && /^[\d\s()+\-.]+$/.test(q ?? "");
  const where = !q
    ? {}
    : auto
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            ...(phoneLike ? [{ phone: { startsWith: digits } }, { phone: { startsWith: `55${digits}` } }] : []),
          ],
        }
      : { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: digits || "x" } }] };
  const customers = await db.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: auto ? 8 : 200,
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
