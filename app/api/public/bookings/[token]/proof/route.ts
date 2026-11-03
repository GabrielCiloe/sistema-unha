import { db } from "@/lib/server/db";
import { clientIp, handle, HttpError, json, rateLimit } from "@/lib/server/http";
import { sniffProof } from "@/lib/validation";
import { acceptLateProof, LATE_PROOF_MESSAGE } from "@/lib/server/holds";

const MAX = 50 * 1024 * 1024; // foto ou PDF do comprovante

export const POST = handle(async (req, ctx) => {
  const { token } = await ctx.params;
  rateLimit(`proof:${clientIp(req)}`, 10, 10 * 60_000);
  const a = await db.appointment.findUnique({
    where: { publicToken: token },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 }, customer: true, items: true },
  });
  const p = a?.payments[0];
  if (!a || !p) throw new HttpError(404, "Reserva não encontrada.");
  if (a.status !== "PENDING_PAYMENT" || !["PENDING", "REJECTED"].includes(p.status))
    throw new HttpError(409, "Esta reserva não aceita comprovante.");
  if (!(await acceptLateProof(a))) throw new HttpError(409, LATE_PROOF_MESSAGE);

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Anexe o comprovante.");
  if (file.size > MAX) throw new HttpError(413, "Arquivo maior que 50 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffProof(buf);
  if (!mime) throw new HttpError(415, "Envie PNG, JPG ou PDF.");

  await db.payment.update({
    where: { id: p.id },
    data: { status: "IN_REVIEW", proofData: buf, proofMime: mime, rejectReason: null },
  });
  return json({ ok: true });
});
