import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { confirmPayment, rejectPayment } from "@/lib/server/payments";

const schema = z.discriminatedUnion("action", [
  // A aprovação exige confirmação explícita de que o valor caiu na conta.
  z.object({ action: z.literal("approve"), confirmedInBank: z.literal(true) }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(200) }),
]);

export const GET = handle(async (_req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const p = await db.payment.findUnique({ where: { id }, select: { proofData: true, proofMime: true } });
  if (!p?.proofData || !p.proofMime) throw new HttpError(404, "Sem comprovante.");
  return new Response(new Uint8Array(p.proofData), {
    headers: { "Content-Type": p.proofMime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});

export const POST = handle(async (req, ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const body = schema.parse(await req.json());
  const p = await db.payment.findUnique({ where: { id } });
  if (!p) throw new HttpError(404, "Pagamento não encontrado.");
  if (p.status === "PAID") throw new HttpError(409, "Pagamento já processado.");
  if (body.action === "approve") await confirmPayment(id);
  else await rejectPayment(id, body.reason);
  return json({ ok: true });
});
