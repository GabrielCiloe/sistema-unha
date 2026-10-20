import { createHmac } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {}
import { expect, test } from "@playwright/test";

const ADMIN = { email: "admin@local.test", password: "dev-password-12345" };
// PNG 1x1 válido
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Começa cada execução sem reservas antigas. Só roda contra banco LOCAL (nunca produção).
// SEGURANÇA: os testes confirmam reservas para números fictícios. Para nunca enviar WhatsApp de verdade,
// a sessão selecionada é desativada durante a execução e restaurada no fim.
let originalWaSession = "";

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127.0.0.1)[:/][^?]*_test/.test(url)) throw new Error("Testes e2e só rodam num banco local cujo nome termina em _test (npm run test:db:setup).");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.messageLog.deleteMany();
  await db.payment.deleteMany();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  await db.webhookEvent.deleteMany();
  const biz = await db.business.findUnique({ where: { id: "main" }, select: { waSessionId: true } });
  originalWaSession = biz?.waSessionId ?? "";
  await db.business.updateMany({ where: { id: "main" }, data: { waSessionId: "" } });
  await db.$disconnect();
});

test.afterAll(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.business.updateMany({ where: { id: "main" }, data: { waSessionId: originalWaSession } });
  await db.$disconnect();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar" }).waitFor();
  await page.waitForTimeout(1500); // aguarda hidratação antes de enviar o formulário
  await page.getByLabel("E-mail").fill(ADMIN.email);
  await page.getByLabel("Senha").fill(ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("painel exige login e rejeita senha errada", async ({ page, request }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  const bad = await request.post("/api/auth/login", { data: { email: ADMIN.email, password: "errada" } });
  expect(bad.status()).toBe(401);
  expect((await request.get("/api/admin/dashboard")).status()).toBe(401);
});

test("fluxo completo: configurar Pix, reservar, enviar comprovante e aprovar", async ({ page, browser }) => {
  await login(page);

  // Configura chave Pix.
  await page.goto("/admin/configuracoes");
  await page.getByLabel("Chave Pix").fill("11144477735");
  await page.getByLabel("Nome do recebedor (como no banco)").fill("Studio Teste");
  await page.getByLabel("Cidade do recebedor").fill("Sao Paulo");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas.")).toBeVisible();

  // Cliente reserva em um contexto separado (sem sessão do admin).
  const ctx = await browser.newContext();
  const client = await ctx.newPage();
  const errors: string[] = [];
  client.on("pageerror", (e) => errors.push(e.message));
  await client.goto("/");
  await client.getByRole("button", { name: /Manicure/ }).click();
  await client.getByRole("group", { name: "Dias disponíveis" }).locator("button:not([disabled])").first().click();
  const slot = client.getByRole("group", { name: "Horários" }).getByRole("button").first();
  await expect(slot).toBeVisible();
  await slot.click();
  await client.getByLabel("Nome").fill("Maria Silva");
  await client.getByLabel("WhatsApp (com DDD)").fill("(11) 91234-5678");
  await client.getByRole("button", { name: "Reservar e pagar o sinal" }).click();
  await expect(client).toHaveURL(/\/reserva\//);
  await expect(client.getByText("Pague o sinal: R$ 13,50")).toBeVisible();
  await expect(client.getByRole("button", { name: /Copiar Pix/ })).toBeVisible();

  // Arquivo inválido é recusado; PNG válido é aceito.
  const input = client.locator('input[type="file"]');
  await input.setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("isso nao e uma imagem") });
  await expect(client.getByText("Envie PNG, JPG ou PDF.")).toBeVisible();
  await input.setInputFiles({ name: "comprovante.png", mimeType: "image/png", buffer: PNG });
  await expect(client.getByText(/Comprovante recebido/)).toBeVisible();

  // Admin analisa e aprova.
  await page.goto("/admin/pagamentos");
  await page.getByRole("button", { name: "Analisar" }).first().click();
  const approve = page.getByRole("button", { name: "Aprovar" });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/Conferi no app do banco/).check();
  await approve.click();
  await expect(page.getByText("Pago").first()).toBeVisible();

  // Cliente vê confirmação (polling) e o envio de WhatsApp foi registrado.
  await client.reload();
  await expect(client.getByText("Horário confirmado!")).toBeVisible();
  await page.goto("/admin/whatsapp");
  // A confirmação enviada aparece na conversa da cliente (sem sessão selecionada fica marcada "sem sessão").
  await page.getByRole("button", { name: /Maria Silva/ }).click();
  await expect(page.getByText(/Olá Maria! Seu horário/).last()).toBeVisible(); // prévia na lista + balão na conversa
  await expect(page.getByText(/sem sessão/).first()).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});

test("horário ocupado some da lista e dupla reserva é bloqueada", async ({ request }) => {
  const info = await (await request.get("/api/public/info")).json();
  const svc = info.services[0].id;
  const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const { slots } = await (await request.get(`/api/public/slots?date=${date}&serviceIds=${svc}`)).json();
  test.skip(slots.length === 0, "sem horários neste dia");
  const body = { serviceIds: [svc], startsAt: slots[0], name: "Ana Souza", phone: "11987654321" };
  const first = await request.post("/api/public/bookings", { data: body });
  expect(first.status()).toBe(201);
  const second = await request.post("/api/public/bookings", { data: { ...body, name: "Bia Lima", phone: "11999998888" } });
  expect(second.status()).toBe(409);
});

test("cron de lembretes exige segredo", async ({ request }) => {
  expect((await request.get("/api/cron/reminders")).status()).toBe(401);
});

test("WhatsApp: webhook do WA-AKG exige HMAC e registra mensagem recebida", async ({ request }) => {
  const secret = process.env.WA_WEBHOOK_SECRET;
  test.skip(!secret, "WA_WEBHOOK_SECRET não definido");
  const body = JSON.stringify({
    event: "message.received",
    data: { key: { id: `T${Date.now()}`, fromMe: false, remoteJid: "5511933332222@s.whatsapp.net" }, from: "100429287395370@lid", content: "Posso remarcar?", isGroup: false },
  });
  const sign = (b: string) => "sha256=" + createHmac("sha256", secret!).update(b).digest("hex");
  const bad = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-webhook-signature": "sha256=00" } });
  expect(bad.status()).toBe(401);
  const ok = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-webhook-signature": sign(body) } });
  expect(ok.status()).toBe(200);
  await request.post("/api/auth/login", { data: ADMIN });
  const wa = await (await request.get("/api/admin/whatsapp")).json();
  expect(wa.messages.some((m: { body: string; phone: string }) => m.body === "Posso remarcar?" && m.phone === "5511933332222")).toBe(true);

  // A conversa aparece na tela de Mensagens (lista + histórico).
  const convs = await (await request.get("/api/admin/messages")).json();
  expect(convs.conversations.some((c: { phone: string; lastBody: string }) => c.phone === "5511933332222" && c.lastBody === "Posso remarcar?")).toBe(true);
  const thread = await (await request.get("/api/admin/messages?phone=11933332222")).json();
  expect(thread.messages.map((m: { body: string }) => m.body)).toContain("Posso remarcar?");
  // Sem sessão conectada o envio falha de forma controlada e fica registrado.
  expect((await request.post("/api/admin/messages", { data: { phone: "11933332222", text: "Claro!" } })).status()).toBe(502);
});

test("WhatsApp: integração real com o WA-AKG local (sessão, QR, envio sem pareamento)", async ({ request }) => {
  await request.post("/api/auth/login", { data: ADMIN });
  const first = await (await request.get("/api/admin/whatsapp")).json();
  test.skip(!first.configured || first.error, "WA-AKG não configurado/indisponível");

  // Cria uma sessão pelo app (cria e inicia no WA-AKG).
  const name = `t${Date.now().toString(36)}`;
  expect((await request.post("/api/admin/whatsapp", { data: { action: "create", name } })).status()).toBe(201);
  const after = await (await request.get("/api/admin/whatsapp")).json();
  const session = after.sessions.find((s: { name: string }) => s.name === name);
  expect(session).toBeTruthy();

  // O QR (string real do Baileys) aparece quando a sessão chega em SCAN_QR.
  let qr: string | null = null;
  for (let i = 0; i < 15 && !qr; i++) {
    qr = (await (await request.get(`/api/admin/whatsapp?qr=${session.sessionId}`)).json()).qr;
    if (!qr) await new Promise((r) => setTimeout(r, 1000));
  }
  expect(qr).toMatch(/^2@/);

  // Envio com sessão não pareada: falha controlada (502) e fica no histórico como FAILED.
  expect((await request.post("/api/admin/whatsapp", { data: { action: "select", sessionId: session.sessionId } })).status()).toBe(200);
  // Registro do webhook no WA-AKG é idempotente (segunda chamada não duplica).
  const w1 = await request.post("/api/admin/whatsapp", { data: { action: "webhook", sessionId: session.sessionId, enabled: true } });
  expect(w1.status()).toBe(200);
  expect((await (await request.post("/api/admin/whatsapp", { data: { action: "webhook", sessionId: session.sessionId, enabled: true } })).json()).created).toBe(false);
  // O interruptor consulta e desliga o webhook de verdade no WA-AKG.
  expect((await (await request.get("/api/admin/whatsapp?receiving=1")).json()).receiving).toBe(true);
  expect((await (await request.post("/api/admin/whatsapp", { data: { action: "webhook", sessionId: session.sessionId, enabled: false } })).json()).removed).toBe(true);
  expect((await (await request.get("/api/admin/whatsapp?receiving=1")).json()).receiving).toBe(false);
  expect((await request.post("/api/admin/whatsapp", { data: { action: "test", phone: "11999990000" } })).status()).toBe(502);
  const log = await (await request.get("/api/admin/whatsapp")).json();
  expect(log.messages.some((m: { status: string }) => m.status === "FAILED")).toBe(true);

  // Limpeza: remove a sessão de teste do WA-AKG (direto na API dele) e desmarca no app.
  await request.delete(`${process.env.WA_AKG_URL}/api/sessions/${session.sessionId}/settings`, { headers: { "X-API-Key": process.env.WA_AKG_API_KEY! } });
  await request.post("/api/admin/whatsapp", { data: { action: "select", sessionId: first.selected ?? "" } }); // restaura a seleção original
});

test("WhatsApp: conectar pela interface mostra o QR ao vivo", async ({ page }) => {
  await login(page);
  test.skip(!process.env.WA_AKG_URL, "WA-AKG não configurado");
  await page.goto("/admin/whatsapp");

  // Sem sessão em uso: botão único para conectar; o menu lateral avisa que não está conectado.
  await expect(page.getByText("Nenhuma sessão em uso")).toBeVisible();
  await page.getByRole("button", { name: "Conectar WhatsApp" }).click();

  // O QR aparece sozinho (SVG) enquanto aguarda o pareamento.
  await expect(page.getByText("Aguardando QR").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("section[aria-labelledby=wa-conn] svg").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/conectar$/).first()).toBeVisible();

  // Limpeza: apaga a sessão de teste criada (nunca a sessão real do usuário, que está desativada neste teste).
  const sel = (await (await page.request.get("/api/admin/whatsapp?status=1")).json()).selected as string;
  expect(sel).toBeTruthy();
  await page.request.delete(`${process.env.WA_AKG_URL}/api/sessions/${sel}/settings`, { headers: { "X-API-Key": process.env.WA_AKG_API_KEY! } });
});
