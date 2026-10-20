// Cliente do WA-AKG (https://github.com/mrifqidaffaaditya/WA-AKG).
// O WA-AKG mantém a conexão Baileys (processo persistente), por isso roda em VPS/Docker
// e este app (que pode estar na Vercel) fala com ele por REST usando X-API-Key.
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, getBusiness } from "./db";

const base = () => (process.env.WA_AKG_URL ?? "").replace(/\/+$/, "");

export const whatsappConfigured = () => Boolean(base() && process.env.WA_AKG_API_KEY);

async function wa(path: string, init: RequestInit = {}) {
  if (!whatsappConfigured()) throw new Error("WhatsApp (WA-AKG) não configurado.");
  const res = await fetch(`${base()}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-API-Key": process.env.WA_AKG_API_KEY!, ...init.headers },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  }).catch(() => {
    throw new Error(`Não foi possível conectar ao WA-AKG em ${base()}. Ele está rodando?`);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? body?.message ?? `WA-AKG respondeu ${res.status}`);
  return body;
}

export const normalizePhone = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
};

export const toJid = (phone: string) => `${normalizePhone(phone)}@s.whatsapp.net`;

export const listSessions = async () => (await wa("/sessions")).data ?? [];
// Cria a sessão e já a inicia (nasce STOPPED). O identificador usado nas demais rotas é o `sessionId` curto.
export async function createSessionRemote(name: string) {
  const res = await wa("/sessions", { method: "POST", body: JSON.stringify({ name }) });
  const sessionId = res?.data?.sessionId as string | undefined;
  if (sessionId) await startSessionRemote(sessionId);
  return sessionId;
}
export const startSessionRemote = (id: string) =>
  wa(`/sessions/${encodeURIComponent(id)}/start`, { method: "POST", body: "{}" });
// Comandos de ciclo de vida: stop, restart, logout (desconecta o aparelho; exige novo QR).
export const sessionCommand = (id: string, command: "stop" | "restart" | "logout") =>
  wa(`/sessions/${encodeURIComponent(id)}/${command}`, { method: "POST", body: "{}" });
// Registra no WA-AKG o webhook que entrega mensagens recebidas ao app (evita duplicar o mesmo URL).
export async function ensureWebhook(sessionId: string, url: string, secret: string) {
  const existing = ((await wa(`/webhooks/${encodeURIComponent(sessionId)}`)).data ?? []) as { url: string }[];
  if (existing.some((w) => w.url === url)) return false;
  await wa(`/webhooks/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ name: "Agenda do estúdio", url, secret, events: ["message.received"] }),
  });
  return true;
}
export async function findWebhook(sessionId: string, url: string) {
  const list = ((await wa(`/webhooks/${encodeURIComponent(sessionId)}`)).data ?? []) as { id: string; url: string }[];
  return list.find((w) => w.url === url)?.id ?? null;
}
export async function removeWebhook(sessionId: string, url: string) {
  const id = await findWebhook(sessionId, url);
  if (!id) return false;
  await wa(`/webhooks/${encodeURIComponent(sessionId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true;
}
export const deleteSessionRemote = (id: string) => wa(`/sessions/${encodeURIComponent(id)}/settings`, { method: "DELETE" });
// Resposta real do WA-AKG: { success, qr: "<string>", base64: "data:image/png..." } (404 enquanto não há QR).
export async function sessionQr(id: string): Promise<string | null> {
  try {
    const r = await wa(`/sessions/${encodeURIComponent(id)}/qr`);
    return typeof r.qr === "string" ? r.qr : null;
  } catch {
    return null;
  }
}

export async function sendText(phone: string, text: string, opts: { customerId?: string; appointmentId?: string } = {}) {
  const biz = await getBusiness();
  const log = (status: string, error?: string) =>
    db.messageLog.create({
      data: { direction: "OUT", phone: normalizePhone(phone), body: text, status, error, ...opts },
    });
  if (!biz.waSessionId) {
    await log("SKIPPED", "Nenhuma sessão WhatsApp selecionada.");
    return false;
  }
  try {
    await wa(`/messages/${encodeURIComponent(biz.waSessionId)}/${encodeURIComponent(toJid(phone))}/send`, {
      method: "POST",
      body: JSON.stringify({ message: { text } }),
    });
    await log("SENT");
    return true;
  } catch (e) {
    await log("FAILED", e instanceof Error ? e.message : "erro");
    return false;
  }
}

export function verifyHmac(raw: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = signature.replace(/^sha256=/, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
