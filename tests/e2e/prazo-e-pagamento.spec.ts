import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiLogin, at, freshIp, login, prisma } from "./helpers";

try {
  process.loadEnvFile(".env");
} catch {}

// Prazo da vaga e confirmação de pagamento, contra o banco de verdade:
// - reserva da CLIENTE (PUBLIC) segura a vaga por 30 min e depois é expirada pelo cron, com aviso;
// - agendamento INTERNO (ADMIN) segura a vaga até o horário do atendimento e não é cancelado antes;
// - confirmar pagamento nunca passa por cima de outro atendimento (409), sem atrapalhar o comprovante normal.
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const MIN = 60_000;
let original: Record<string, unknown> = {};
let manicure = "";

// Dia de atendimento (seg–sáb) a partir de `offset` dias, longe dos outros testes.
function workday(offset: number) {
  const d = new Date(Date.now() + offset * 86400_000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  const db = await prisma();
  await db.messageLog.deleteMany();
  await db.payment.deleteMany();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  const b = await db.business.findUniqueOrThrow({ where: { id: "main" } });
  original = {
    openMinutes: b.openMinutes, closeMinutes: b.closeMinutes, slotStepMinutes: b.slotStepMinutes, bufferMinutes: b.bufferMinutes, minLeadDays: b.minLeadDays,
    workDays: b.workDays, schedule: b.schedule ?? {}, depositPercent: b.depositPercent, waSessionId: b.waSessionId, pixKey: b.pixKey, pixName: b.pixName, pixCity: b.pixCity,
  };
  // Sem sessão de WhatsApp: os avisos ficam só registrados no histórico (SKIPPED), nada é enviado.
  await db.business.update({
    where: { id: "main" },
    data: {
      openMinutes: 540, closeMinutes: 1080, slotStepMinutes: 15, bufferMinutes: 0, minLeadDays: 0, workDays: [1, 2, 3, 4, 5, 6], schedule: {},
      depositPercent: 30, waSessionId: "", pixKey: "11144477735", pixName: "Studio Teste", pixCity: "Sao Paulo",
    },
  });
  manicure = (await db.service.findFirstOrThrow({ where: { name: "Manicure", deletedAt: null } })).id;
  await db.$disconnect();
});

test.afterAll(async () => {
  const db = await prisma();
  await db.messageLog.deleteMany();
  await db.payment.deleteMany();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  await db.business.update({ where: { id: "main" }, data: original as never });
  await db.$disconnect();
});

let phoneSeq = 0;
const nextPhone = () => `119666${String(++phoneSeq).padStart(5, "0")}`;
const stored = (phone: string) => `55${phone}`;

async function bookPublic(request: APIRequestContext, startsAt: string, name: string) {
  const phone = nextPhone();
  const r = await request.post("/api/public/bookings", { data: { serviceIds: [manicure], startsAt, name, phone } });
  expect(r.status(), `reserva pública ${name}`).toBe(201);
  return { phone: stored(phone), token: (await r.json()).token as string };
}
async function bookInternal(request: APIRequestContext, startsAt: string, name: string) {
  const phone = nextPhone();
  const r = await request.post("/api/admin/appointments", { data: { serviceIds: [manicure], startsAt, name, phone } });
  expect(r.status(), `agendamento interno ${name}`).toBe(201);
  const body = await r.json();
  return { phone: stored(phone), id: body.appointment.id as string, paymentId: body.payment.id as string, pixPayload: body.payment.pixPayload as string };
}
const cron = (request: APIRequestContext) => request.get("/api/cron/reminders", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
const approve = (request: APIRequestContext, paymentId: string) => request.post(`/api/admin/payments/${paymentId}`, { data: { action: "approve", confirmedInBank: true } });
const sendProof = (request: APIRequestContext, token: string) =>
  request.post(`/api/public/bookings/${token}/proof`, { multipart: { file: { name: "comprovante.png", mimeType: "image/png", buffer: PNG } }, headers: freshIp() });
const publicSlots = async (request: APIRequestContext, date: string) => (await (await request.get(`/api/public/slots?date=${date}&serviceIds=${manicure}`)).json()).slots as string[];

test("prazo da vaga: interno pendente segura o horário até o atendimento e o cron não o cancela; a reserva da cliente continua expirando em 30 min", async ({ request, page }) => {
  test.skip(!process.env.CRON_SECRET, "CRON_SECRET não definido no .env");
  const W = workday(50);
  await apiLogin(request);
  const interno = await bookInternal(request, at(W, "10:00"), "Ines Interna");
  const publica = await bookPublic(request, at(W, "14:00"), "Paula Publica");

  const db = await prisma();
  const i0 = await db.appointment.findUniqueOrThrow({ where: { id: interno.id } });
  const p0 = await db.appointment.findFirstOrThrow({ where: { customerId: publica.phone } });
  // Interno: a vaga vale até o horário do atendimento. Pública: 30 minutos a partir da reserva.
  expect(i0.source).toBe("ADMIN");
  expect(i0.holdUntil.toISOString()).toBe(at(W, "10:00"));
  expect(p0.source).toBe("PUBLIC");
  const holdMin = (p0.holdUntil.getTime() - p0.createdAt.getTime()) / MIN;
  expect(holdMin).toBeGreaterThan(29.9);
  expect(holdMin).toBeLessThan(30.1);
  // Antes do prazo o cron não mexe em nenhuma das duas.
  expect((await (await cron(request)).json()).expired).toBe(0);

  // 40 minutos depois (o teste recua no banco o que depende do relógio: criação das duas e o prazo de 30 min da pública;
  // o prazo da interna é o horário do atendimento e não muda com o tempo).
  const ago = new Date(Date.now() - 40 * MIN);
  await db.appointment.update({ where: { id: interno.id }, data: { createdAt: ago } });
  await db.appointment.update({ where: { id: p0.id }, data: { createdAt: ago, holdUntil: new Date(Date.now() - 10 * MIN) } });

  // Sem o cron rodar, o horário da pública já está livre de novo; o da interna continua ocupado.
  let slots = await publicSlots(request, W);
  expect(slots).not.toContain(at(W, "10:00"));
  expect(slots).not.toContain(at(W, "10:30"));
  expect(slots).toContain(at(W, "14:00"));

  // Cron: expira só a reserva da cliente (cancela, pagamento expirado e aviso registrado); a interna segue aguardando o sinal.
  const ran = await cron(request);
  expect(ran.status()).toBe(200);
  expect((await ran.json()).expired).toBe(1);
  const p1 = await db.appointment.findUniqueOrThrow({ where: { id: p0.id }, include: { payments: true } });
  expect(p1.status).toBe("CANCELLED");
  expect(p1.payments[0].status).toBe("EXPIRED");
  const notice = await db.messageLog.findMany({ where: { appointmentId: p0.id } });
  expect(notice).toHaveLength(1);
  expect(notice[0].body).toContain("não recebemos o comprovante do sinal");
  const i1 = await db.appointment.findUniqueOrThrow({ where: { id: interno.id }, include: { payments: true } });
  expect(i1.status).toBe("PENDING_PAYMENT");
  expect(i1.payments[0].status).toBe("PENDING");
  expect(await db.messageLog.count({ where: { appointmentId: interno.id } })).toBe(0);

  // Outra cliente não consegue o horário da interna (409) e consegue o que a pública perdeu (201).
  const taken = await request.post("/api/public/bookings", { data: { serviceIds: [manicure], startsAt: at(W, "10:00"), name: "Tania Tenta", phone: nextPhone() } });
  expect(taken.status()).toBe(409);
  const again = await bookPublic(request, at(W, "14:00"), "Nova Cliente");
  slots = await publicSlots(request, W);
  expect(slots).not.toContain(at(W, "14:00"));

  // Página /reserva/[token]: a interna não promete prazo de 30 min; a da cliente continua mostrando a hora-limite.
  const internalView = await (await request.get(`/api/public/bookings/${i1.publicToken}`)).json();
  expect(internalView.appointment.internal).toBe(true);
  const publicView = await (await request.get(`/api/public/bookings/${again.token}`)).json();
  expect(publicView.appointment).not.toHaveProperty("internal");
  expect(Object.keys(publicView.appointment).sort()).toEqual(["customerName", "depositCents", "holdUntil", "items", "startsAt", "status", "totalCents"]);
  await page.goto(`/reserva/${i1.publicToken}`);
  await expect(page.getByText("Envie o comprovante antes do horário do atendimento.")).toBeVisible();
  await expect(page.getByText(/Sua vaga fica reservada até/)).toHaveCount(0);
  await page.goto(`/reserva/${again.token}`);
  await expect(page.getByText(/Sua vaga fica reservada até \d{2}:\d{2}/)).toBeVisible();
  await expect(page.getByText("Envie o comprovante antes do horário do atendimento.")).toHaveCount(0);

  // Chegou o horário do atendimento interno sem sinal: aí sim o cron libera a vaga, sem mensagem automática à cliente.
  const past = new Date(Date.now() - 5 * MIN);
  await db.appointment.update({ where: { id: interno.id }, data: { startsAt: past, endsAt: new Date(past.getTime() + 45 * MIN), holdUntil: past } });
  expect((await (await cron(request)).json()).expired).toBe(1);
  const i2 = await db.appointment.findUniqueOrThrow({ where: { id: interno.id }, include: { payments: true } });
  expect(i2.status).toBe("CANCELLED");
  expect(i2.payments[0].status).toBe("EXPIRED");
  expect(await db.messageLog.count({ where: { appointmentId: interno.id } })).toBe(0);
  await db.$disconnect();
});

test("reagendar um agendamento interno pendente leva o prazo da vaga para o novo horário", async ({ request }) => {
  const W = workday(53);
  const later = workday(56);
  await apiLogin(request);
  const interno = await bookInternal(request, at(W, "10:00"), "Regina Remarca");
  const moved = await request.post(`/api/admin/appointments/${interno.id}/reschedule`, { data: { startsAt: at(later, "11:00") } });
  expect(moved.status()).toBe(200);
  const db = await prisma();
  const a = await db.appointment.findUniqueOrThrow({ where: { id: interno.id } });
  expect(a.startsAt.toISOString()).toBe(at(later, "11:00"));
  // Se o prazo ficasse no horário antigo, a vaga nova deixaria de ser bloqueada (e o cron cancelaria) antes do atendimento.
  expect(a.holdUntil.toISOString()).toBe(at(later, "11:00"));
  // Reserva da cliente remarcada pela dona: o prazo de 30 min do sinal não muda.
  const pub = await bookPublic(request, at(W, "13:00"), "Priscila Remarca");
  const before = await db.appointment.findFirstOrThrow({ where: { customerId: pub.phone } });
  expect((await request.post(`/api/admin/appointments/${before.id}/reschedule`, { data: { startsAt: at(later, "13:00") } })).status()).toBe(200);
  const after = await db.appointment.findUniqueOrThrow({ where: { id: before.id } });
  expect(after.holdUntil.toISOString()).toBe(before.holdUntil.toISOString());
  await db.$disconnect();
});

test("confirmar pagamento: reserva expirada com o horário já ocupado dá 409; comprovante normal, atrasado e horário ainda livre continuam confirmando", async ({ request }) => {
  test.skip(!process.env.CRON_SECRET, "CRON_SECRET não definido no .env");
  const W = workday(60);
  await apiLogin(request);
  const db = await prisma();
  const apptOf = (phone: string) => db.appointment.findFirstOrThrow({ where: { customerId: phone }, include: { payments: true } });
  const expireNow = async (id: string) => db.appointment.update({ where: { id }, data: { holdUntil: new Date(Date.now() - 10 * MIN) } });

  // A e C reservam, não pagam e são expiradas pelo cron.
  const a = await bookPublic(request, at(W, "10:00"), "Alice Expirada");
  const c = await bookPublic(request, at(W, "11:00"), "Carla Expirada");
  const a0 = await apptOf(a.phone);
  const c0 = await apptOf(c.phone);
  await expireNow(a0.id);
  await expireNow(c0.id);
  expect((await (await cron(request)).json()).expired).toBe(2);
  // B pega o horário que era de A.
  const b = await bookPublic(request, at(W, "10:00"), "Bruna Nova");

  // Aprovar o pagamento de A agora passaria por cima de B: 409 e nada muda.
  const clash = await approve(request, a0.payments[0].id);
  expect(clash.status()).toBe(409);
  expect((await clash.json()).error).toMatch(/já foi ocupado por outro atendimento/);
  const a1 = await apptOf(a.phone);
  expect(a1.status).toBe("CANCELLED");
  expect(a1.payments[0].status).toBe("EXPIRED");
  expect((await apptOf(b.phone)).status).toBe("PENDING_PAYMENT");
  // Mesmo com B já confirmada.
  await sendProof(request, b.token);
  expect((await approve(request, (await apptOf(b.phone)).payments[0].id)).status()).toBe(200);
  expect((await apptOf(b.phone)).status).toBe("CONFIRMED");
  expect((await approve(request, a0.payments[0].id)).status()).toBe(409);

  // C expirou, mas o horário dela continua livre: a dona pode confirmar (ex.: pagou por fora).
  expect((await approve(request, c0.payments[0].id)).status()).toBe(200);
  const c1 = await apptOf(c.phone);
  expect(c1.status).toBe("CONFIRMED");
  expect(c1.payments[0].status).toBe("PAID");

  // Fluxo normal: comprovante dentro do prazo → em análise → aprovado.
  const d = await bookPublic(request, at(W, "13:00"), "Dora Normal");
  expect((await sendProof(request, d.token)).status()).toBe(200);
  const d0 = await apptOf(d.phone);
  expect(d0.payments[0].status).toBe("IN_REVIEW");
  expect((await approve(request, d0.payments[0].id)).status()).toBe(200);
  expect((await apptOf(d.phone)).status).toBe("CONFIRMED");

  // Comprovante atrasado (prazo vencido, cron ainda não rodou) com a vaga livre: aceito e aprovado.
  const e = await bookPublic(request, at(W, "14:00"), "Elisa Atrasada");
  const e0 = await apptOf(e.phone);
  await expireNow(e0.id);
  expect((await sendProof(request, e.token)).status()).toBe(200);
  expect((await (await cron(request)).json()).expired).toBe(0); // em análise não expira
  expect((await approve(request, e0.payments[0].id)).status()).toBe(200);
  expect((await apptOf(e.phone)).status).toBe("CONFIRMED");

  // Comprovante atrasado com a vaga já tomada: recusado na hora (409) e a reserva é expirada.
  const f = await bookPublic(request, at(W, "15:00"), "Fabia Atrasada");
  const f0 = await apptOf(f.phone);
  await expireNow(f0.id);
  await bookPublic(request, at(W, "15:00"), "Gabi Rapida");
  expect((await sendProof(request, f.token)).status()).toBe(409);
  expect((await apptOf(f.phone)).status).toBe("CANCELLED");

  // Reservas vizinhas feitas sem pausa; depois a dona passa a exigir 15 min de pausa entre atendimentos.
  // O comprovante em análise segura a própria vaga: aprovar não pode acusar "horário ocupado" por causa da vizinha.
  const h = await bookPublic(request, at(W, "16:00"), "Helena Vizinha");
  const i = await bookPublic(request, at(W, "16:45"), "Iara Vizinha");
  expect((await sendProof(request, h.token)).status()).toBe(200);
  expect((await sendProof(request, i.token)).status()).toBe(200);
  await db.business.update({ where: { id: "main" }, data: { bufferMinutes: 15 } });
  try {
    expect((await approve(request, (await apptOf(h.phone)).payments[0].id)).status()).toBe(200);
    expect((await approve(request, (await apptOf(i.phone)).payments[0].id)).status()).toBe(200);
  } finally {
    await db.business.update({ where: { id: "main" }, data: { bufferMinutes: 0 } });
  }
  expect((await apptOf(i.phone)).status).toBe("CONFIRMED");
  await db.$disconnect();
});

test("agenda: 'Pix do sinal' reabre o copia e cola de um agendamento que aguarda o sinal e permite marcar como recebido", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("dialog", (d) => d.accept());
  const W = workday(64);
  await login(page);
  const interno = await bookInternal(page.request, at(W, "10:00"), "Pietra Pix");

  // Navega até o mês do atendimento e abre o dia.
  await page.goto("/admin/agenda");
  const now = new Date();
  const months = (Number(W.slice(0, 4)) - now.getFullYear()) * 12 + (Number(W.slice(5, 7)) - 1 - now.getMonth());
  for (let n = 0; n < months; n++) await page.getByRole("button", { name: "Próximo mês" }).click();
  await page.getByRole("button", { name: new RegExp(`^${W.slice(8)}/${W.slice(5, 7)}: 1 agendamento`) }).click();
  const day = page.getByRole("dialog");
  await expect(day).toContainText("Pietra Pix");
  await expect(day.getByText("interno", { exact: true })).toBeVisible();

  // "Pix do sinal": o mesmo código gravado no pagamento, com a explicação do prazo do agendamento interno.
  await day.getByRole("button", { name: "Pix do sinal" }).click();
  const pix = page.getByRole("dialog", { name: "Pix do sinal" });
  await expect(pix).toContainText("Pietra Pix");
  await expect(pix).toContainText("Sinal: R$ 13,50");
  await expect(pix.getByLabel("Pix copia e cola do sinal")).toHaveValue(interno.pixPayload);
  await expect(pix).toContainText("A vaga fica reservada até o horário do atendimento");
  await pix.getByRole("button", { name: "Copiar Pix copia e cola" }).click();
  await expect(page.getByText("Pix copia e cola copiado.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(interno.pixPayload);

  // Fecha com Esc (aqui pode) e reabre: o código continua lá.
  await page.keyboard.press("Escape");
  await expect(pix).toBeHidden();
  await expect(page.getByRole("dialog")).toContainText("Pietra Pix");
  await page.getByRole("dialog").getByRole("button", { name: "Pix do sinal" }).click();
  await expect(pix.getByLabel("Pix copia e cola do sinal")).toHaveValue(interno.pixPayload);

  // Marcar como recebido por aqui confirma o agendamento; ao voltar, o botão some (não há mais sinal a pagar).
  await pix.getByRole("button", { name: "Marcar sinal como já recebido" }).click();
  await expect(pix.getByText("Sinal recebido. O agendamento está confirmado.")).toBeVisible();
  await pix.getByRole("button", { name: "Voltar à agenda" }).click();
  const back = page.getByRole("dialog");
  await expect(back).toContainText("Pietra Pix");
  await expect(back.getByRole("button", { name: "Pix do sinal" })).toHaveCount(0);
  const db = await prisma();
  const a = await db.appointment.findUniqueOrThrow({ where: { id: interno.id }, include: { payments: true } });
  expect(a.status).toBe("CONFIRMED");
  expect(a.payments[0].status).toBe("PAID");
  await db.$disconnect();
});
