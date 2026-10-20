import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { normalizePhone, verifyHmac } from "@/lib/server/whatsapp";

// Recebe eventos do WA-AKG (message.received) e guarda no histórico.
// Configure no WA-AKG: URL = <app>/api/webhooks/whatsapp, secret = WA_WEBHOOK_SECRET.
export const POST = handle(async (req) => {
  const raw = await req.text();
  const secret = process.env.WA_WEBHOOK_SECRET;
  const sig = req.headers.get("x-webhook-signature"); // confirmado no código do WA-AKG (lib/webhook.ts)
  if (!verifyHmac(raw, sig, secret)) throw new HttpError(401, "Assinatura inválida.");

  const evt = JSON.parse(raw) as {
    event?: string;
    data?: { key?: { id?: string; fromMe?: boolean; remoteJid?: string }; from?: string; content?: string; isGroup?: boolean };
  };
  const d = evt.data;
  if (evt.event !== "message.received" || !d?.from || d.isGroup || d.key?.fromMe) return json({ ok: true });

  const id = d.key?.id ? `wa:${d.key.id}` : null;
  if (id) {
    const seen = await db.webhookEvent.createMany({ data: [{ id, source: "whatsapp" }], skipDuplicates: true });
    if (seen.count === 0) return json({ ok: true, duplicate: true });
  }
  // `from` pode ser um LID (@lid); o telefone real vem em key.remoteJid (@s.whatsapp.net).
  const jid = [d.key?.remoteJid, d.from].find((j) => j?.endsWith("@s.whatsapp.net"));
  if (!jid) return json({ ok: true, ignored: "sem telefone" });
  const phone = normalizePhone(jid.split("@")[0]);
  const customer = await db.customer.findUnique({ where: { phone } });
  const body = String(d.content ?? "").slice(0, 2000);
  await db.messageLog.create({ data: { direction: "IN", phone, body, customerId: customer?.phone } });
  // Quem pede para parar não recebe mais convites de retorno.
  if (customer && /^\s*(sair|parar|pare|cancelar inscri[cç][aã]o)\s*[.!]*\s*$/i.test(body)) {
    await db.customer.update({ where: { phone }, data: { returnOptOut: true } });
  }
  return json({ ok: true });
});
