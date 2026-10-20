import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { createSessionRemote, sessionCommand, ensureWebhook, findWebhook, removeWebhook, listSessions, startSessionRemote, sendText, sessionQr, whatsappConfigured } from "@/lib/server/whatsapp";

// Endereço público que o WA-AKG chama para entregar mensagens recebidas.
const webhookUrl = () => {
  const origin = process.env.APP_ORIGIN;
  return origin ? `${origin.replace(/\/+$/, "")}/api/webhooks/whatsapp` : null;
};

// GET ?qr=<sessionId> devolve o QR de pareamento; sem parâmetro, lista sessões + mensagens recentes.
export const GET = handle(async (req) => {
  await requireUser();
  const qr = new URL(req.url).searchParams.get("qr");
  const configured = whatsappConfigured();
  // ?receiving=1: o webhook de mensagens recebidas está ativo na sessão em uso?
  if (new URL(req.url).searchParams.get("receiving")) {
    const biz = await getBusiness();
    const url = webhookUrl();
    if (!configured || !biz.waSessionId || !url) return json({ receiving: false, available: Boolean(url) });
    try {
      return json({ receiving: Boolean(await findWebhook(biz.waSessionId, url)), available: true });
    } catch {
      return json({ receiving: false, available: true });
    }
  }
  // ?status=1: estado leve da sessão em uso (usado pelo indicador do menu e pela tela de conexão).
  if (new URL(req.url).searchParams.get("status")) {
    const biz = await getBusiness();
    if (!configured) return json({ configured: false, selected: "", status: null });
    try {
      const sessions = (await listSessions()) as { sessionId?: string; status?: string }[];
      const s = sessions.find((x) => x.sessionId === biz.waSessionId);
      return json({ configured: true, selected: biz.waSessionId, status: s?.status ?? null });
    } catch (e) {
      return json({ configured: true, selected: biz.waSessionId, status: null, error: e instanceof Error ? e.message : "WA-AKG indisponível." });
    }
  }
  if (qr && configured) return json({ qr: await sessionQr(qr) });
  // O histórico aparece mesmo sem WA-AKG (mostra mensagens que não puderam ser enviadas).
  const [biz, messages] = await Promise.all([
    getBusiness(),
    db.messageLog.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  let sessions: unknown[] = [];
  let error: string | undefined;
  if (configured) {
    try {
      sessions = await listSessions();
    } catch (e) {
      error = e instanceof Error ? e.message : "WA-AKG indisponível.";
    }
  }
  return json({ configured, sessions, selected: biz.waSessionId, messages, error });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,40}$/, "Use letras, números, - ou _ (3 a 40).") }),
  z.object({ action: z.literal("start"), sessionId: z.string().trim().max(80) }),
  z.object({ action: z.literal("webhook"), sessionId: z.string().trim().max(80), enabled: z.boolean().default(true) }),
  z.object({ action: z.literal("control"), sessionId: z.string().trim().max(80), command: z.enum(["start", "stop", "restart", "logout"]) }),
  // Cria, inicia e já seleciona a sessão: um clique para conectar o WhatsApp.
  z.object({ action: z.literal("connect") }),
  z.object({ action: z.literal("select"), sessionId: z.string().trim().max(80) }),
  z.object({ action: z.literal("test"), phone: z.string().trim().min(8).max(20) }),
]);

export const POST = handle(async (req) => {
  await requireUser();
  const body = schema.parse(await req.json());
  if (body.action === "select") {
    await getBusiness(); // garante o registro com os padrões
    await db.business.update({ where: { id: "main" }, data: { waSessionId: body.sessionId } });
    return json({ ok: true });
  }
  if (!whatsappConfigured()) throw new HttpError(503, "WA-AKG não configurado nas variáveis de ambiente.");
  if (body.action === "create") {
    await createSessionRemote(body.name);
    return json({ ok: true }, 201);
  }
  if (body.action === "webhook") {
    const url = webhookUrl();
    const secret = process.env.WA_WEBHOOK_SECRET;
    if (!url || !secret) throw new HttpError(503, "Defina APP_ORIGIN e WA_WEBHOOK_SECRET no .env.");
    if (!body.enabled) return json({ ok: true, removed: await removeWebhook(body.sessionId, url) });
    const created = await ensureWebhook(body.sessionId, url, secret);
    return json({ ok: true, created });
  }
  if (body.action === "connect") {
    const biz = await getBusiness();
    const existing = ((await listSessions()) as { sessionId?: string; status?: string }[]).find((x) => x.sessionId === biz.waSessionId);
    if (existing) {
      if (existing.status === "STOPPED" || existing.status === "LOGGED_OUT" || existing.status === "DISCONNECTED") await startSessionRemote(existing.sessionId!);
      return json({ ok: true, sessionId: existing.sessionId });
    }
    const sessionId = await createSessionRemote("estudio");
    if (!sessionId) throw new HttpError(502, "O WA-AKG não devolveu o identificador da sessão.");
    await db.business.update({ where: { id: "main" }, data: { waSessionId: sessionId } });
    return json({ ok: true, sessionId }, 201);
  }
  if (body.action === "control") {
    if (body.command === "start") await startSessionRemote(body.sessionId);
    else await sessionCommand(body.sessionId, body.command);
    return json({ ok: true });
  }
  if (body.action === "start") {
    await startSessionRemote(body.sessionId);
    return json({ ok: true });
  }
  const biz = await getBusiness();
  const ok = await sendText(body.phone, `✅ Teste de conexão do ${biz.name}. WhatsApp integrado com sucesso!`);
  if (!ok) throw new HttpError(502, "Não foi possível enviar. Verifique a sessão selecionada e a conexão.");
  return json({ ok: true });
});
