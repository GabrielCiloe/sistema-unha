import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { fetchMedia, normalizePhone, phoneVariants, sendText, verifyHmac } from "@/lib/server/whatsapp";
import { attachProofFromWhatsApp } from "@/lib/server/payments";
import { sniffProof } from "@/lib/validation";
import { fmtDateTime } from "@/lib/templates";

const MAX_PROOF = 50 * 1024 * 1024;

// Recebe eventos do WA-AKG (message.received) e guarda no histórico.
// Configure no WA-AKG: URL = <app>/api/webhooks/whatsapp, secret = WA_WEBHOOK_SECRET.
export const POST = handle(async (req) => {
  const raw = await req.text();
  const secret = process.env.WA_WEBHOOK_SECRET;
  const sig = req.headers.get("x-webhook-signature"); // confirmado no código do WA-AKG (lib/webhook.ts)
  if (!verifyHmac(raw, sig, secret)) throw new HttpError(401, "Assinatura inválida.");

  const evt = JSON.parse(raw) as {
    event?: string;
    data?: { key?: { id?: string; fromMe?: boolean; remoteJid?: string }; from?: string; content?: string; isGroup?: boolean; type?: string; fileUrl?: string | null; caption?: string };
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
  // Com ou sem o nono dígito: procura a cliente nas duas formas e registra tudo no número cadastrado por ela.
  const incoming = normalizePhone(jid.split("@")[0]);
  const customer = await db.customer.findFirst({ where: { phone: { in: phoneVariants(incoming) } } });
  const phone = customer?.phone ?? incoming;
  const isMedia = (d.type === "IMAGE" || d.type === "DOCUMENT") && typeof d.fileUrl === "string";
  const body = (isMedia ? `[${d.type === "IMAGE" ? "imagem" : "arquivo"}] ${d.caption || d.content || ""}` : String(d.content ?? "")).trim().slice(0, 2000);
  await db.messageLog.create({ data: { direction: "IN", phone, body, customerId: customer?.phone } });

  // Caminho 2: a cliente compartilha o comprovante do app do banco direto no WhatsApp do estúdio.
  // Se ela tem reserva aguardando sinal, o arquivo vira o comprovante (em análise) e ela recebe um aviso.
  if (isMedia && customer) {
    const media = await fetchMedia(d.fileUrl!, MAX_PROOF);
    const mime = media ? sniffProof(media.data) : null;
    if (media && mime) {
      const r = await attachProofFromWhatsApp(phone, media.data, mime);
      if (r.attached) {
        // O aviso sai uma vez por reserva (proofAckSentAt); imagens repetidas não geram nova mensagem.
        if (!r.ackSent) {
          await db.appointment.update({ where: { id: r.appointmentId }, data: { proofAckSentAt: new Date() } });
          const first = customer.name.split(" ")[0];
          await sendText(phone, `Recebemos seu comprovante, ${first}! Assim que conferirmos o pagamento, confirmamos seu horário (${r.service}, ${fmtDateTime(r.startsAt)}) por aqui.`, { customerId: phone, appointmentId: r.appointmentId });
        }
        return json({ ok: true, proof: "attached", ack: !r.ackSent });
      }
      if (r.expired) return json({ ok: true, proof: "expired" }); // a cliente já foi avisada (lib/server/holds.ts)
    }
  }
  // Quem pede para parar não recebe mais convites de retorno.
  if (customer && /^\s*(sair|parar|pare|cancelar inscri[cç][aã]o)\s*[.!]*\s*$/i.test(body)) {
    await db.customer.update({ where: { phone }, data: { returnOptOut: true } });
  }
  return json({ ok: true });
});
