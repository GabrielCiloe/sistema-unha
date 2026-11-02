import { expect, test, type APIRequestContext } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {}

const ADMIN = { email: "admin@local.test", password: "dev-password-12345" };
let original: Record<string, unknown> = {};

// Dia de atendimento (seg–sáb) a ~40 dias, para não colidir com outros testes.
function workday(offset = 0) {
  const d = new Date(Date.now() + (40 + offset) * 86400_000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function sunday() {
  const d = new Date(Date.now() + 40 * 86400_000);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
// Horário local (UTC-3) -> ISO em UTC.
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`).toISOString();

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127.0.0.1)[:/][^?]*_test/.test(url)) throw new Error("Testes e2e só rodam num banco local cujo nome termina em _test (npm run test:db:setup).");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.messageLog.deleteMany();
  await db.payment.deleteMany();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  const b = await db.business.findUnique({ where: { id: "main" } });
  original = { openMinutes: b?.openMinutes, closeMinutes: b?.closeMinutes, slotStepMinutes: b?.slotStepMinutes, bufferMinutes: b?.bufferMinutes, minLeadDays: b?.minLeadDays, workDays: b?.workDays, waSessionId: b?.waSessionId };
  // Sem sessão de WhatsApp: nada é enviado de verdade durante os testes.
  await db.business.update({ where: { id: "main" }, data: { openMinutes: 540, closeMinutes: 1080, slotStepMinutes: 30, bufferMinutes: 0, minLeadDays: 0, workDays: [1, 2, 3, 4, 5, 6], waSessionId: "", pixKey: "11144477735", pixName: "Studio Teste", pixCity: "Sao Paulo" } });
  await db.$disconnect();
});

test.afterAll(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  await db.business.update({ where: { id: "main" }, data: original as never });
  await db.$disconnect();
});

async function setHours(request: APIRequestContext, patch: Record<string, unknown>) {
  await request.post("/api/auth/login", { data: ADMIN });
  const { business } = await (await request.get("/api/admin/business")).json();
  const { id: _i, updatedAt: _u, ...rest } = business;
  const res = await request.put("/api/admin/business", { data: { ...rest, ...patch } });
  expect(res.status()).toBe(200);
}

async function services(request: APIRequestContext) {
  const info = await (await request.get("/api/public/info")).json();
  const by = (n: string) => info.services.find((s: { name: string }) => s.name === n).id as string;
  return { manicure: by("Manicure"), alongamento: by("Alongamento em gel"), pedicure: by("Pedicure") };
}

const slotsOf = async (request: APIRequestContext, date: string, ids: string[]) =>
  (await (await request.get(`/api/public/slots?date=${date}&serviceIds=${ids.join(",")}`)).json()) as { slots: string[]; reason: string | null; message: string | null };

let phoneSeq = 0;
const book = (request: APIRequestContext, ids: string[], startsAt: string) =>
  request.post("/api/public/bookings", { data: { serviceIds: ids, startsAt, name: "Cliente Teste", phone: `1190000${String(1000 + phoneSeq++)}` } });

test("horários começam logo quando o atendimento anterior termina (sem buracos)", async ({ request }) => {
  await setHours(request, { bufferMinutes: 0, slotStepMinutes: 30, openMinutes: 540, closeMinutes: 1080 });
  const { manicure } = await services(request);
  const d = workday(0);

  const before = await slotsOf(request, d, [manicure]);
  expect(before.slots[0]).toBe(at(d, "09:00"));

  expect((await book(request, [manicure], at(d, "09:00"))).status()).toBe(201); // 09:00–09:45

  // O próximo horário é 09:45 (fim do anterior), não 10:00 nem 10:30 da grade fixa.
  const after = await slotsOf(request, d, [manicure]);
  expect(after.slots[0]).toBe(at(d, "09:45"));
  expect(after.slots[1]).toBe(at(d, "10:15"));
  expect(after.slots).not.toContain(at(d, "10:00"));

  // E o 09:45 pode ser reservado de fato, encaixado logo após o anterior.
  expect((await book(request, [manicure], at(d, "09:45"))).status()).toBe(201);
  expect((await slotsOf(request, d, [manicure])).slots[0]).toBe(at(d, "10:30"));
});

test("serviço de 120 min: o próximo horário abre exatamente no fim dele", async ({ request }) => {
  await setHours(request, { bufferMinutes: 0, slotStepMinutes: 30, openMinutes: 540, closeMinutes: 1080 });
  const { alongamento, manicure } = await services(request);
  const d = workday(1);

  expect((await book(request, [alongamento], at(d, "11:00"))).status()).toBe(201); // 11:00–13:00
  const s = (await slotsOf(request, d, [manicure])).slots;
  expect(s).toContain(at(d, "13:00")); // abre às 13h, sem janela
  expect(s).not.toContain(at(d, "12:30")); // ainda ocupado
  expect(s).not.toContain(at(d, "11:00"));
  // Antes do atendimento só cabem horários que terminam até as 11h; o último encaixa exatamente (10:15–11:00).
  expect(s).toContain(at(d, "10:00"));
  expect(s).toContain(at(d, "10:15"));
  expect(s).not.toContain(at(d, "10:30")); // 10:30 + 45 min invadiria as 11h
});

test("pausa entre atendimentos configurada pelo gestor", async ({ request }) => {
  await setHours(request, { bufferMinutes: 15, slotStepMinutes: 30, openMinutes: 540, closeMinutes: 1080 });
  const { manicure } = await services(request);
  const d = workday(2);

  expect((await book(request, [manicure], at(d, "09:00"))).status()).toBe(201); // 09:00–09:45 (+15 de pausa)
  expect((await slotsOf(request, d, [manicure])).slots[0]).toBe(at(d, "10:00"));
  // O servidor aplica a mesma regra na reserva (não só a tela).
  expect((await book(request, [manicure], at(d, "09:50"))).status()).toBe(409);
  expect((await book(request, [manicure], at(d, "10:00"))).status()).toBe(201);
  await setHours(request, { bufferMinutes: 0 });
});

test("duração maior que o expediente: avisa a cliente com o motivo", async ({ request, page }) => {
  await setHours(request, { openMinutes: 540, closeMinutes: 630, bufferMinutes: 0 }); // 09:00–10:30 (90 min)
  const { alongamento, manicure, pedicure } = await services(request);
  const d = workday(3);

  const r = await slotsOf(request, d, [alongamento]);
  expect(r.slots).toEqual([]);
  expect(r.reason).toBe("too_long");
  expect(r.message).toContain("2h");
  expect(r.message).toContain("expediente");

  const av = await (await request.get(`/api/public/availability?serviceIds=${alongamento}&days=14`)).json();
  const open = av.days.filter((x: { reason: string }) => x.reason !== "closed");
  expect(open.length).toBeGreaterThan(0);
  expect(open.every((x: { available: boolean; reason: string }) => !x.available && x.reason === "too_long")).toBe(true);

  // Tela: aviso claro e dias desabilitados.
  await page.goto("/");
  await page.getByRole("button", { name: /Alongamento em gel/ }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Os serviços escolhidos somam 2h");
  await expect(page.getByRole("group", { name: "Dias disponíveis" }).locator("button:not([disabled])")).toHaveCount(0);

  // Agenda parcialmente ocupada: sobra um período menor que o serviço -> motivo "full".
  expect((await book(request, [manicure], at(d, "09:00"))).status()).toBe(201); // 09:00–09:45; sobram 45 min
  const full = await slotsOf(request, d, [pedicure]); // 60 min não cabe nos 45 restantes
  expect(full.slots).toEqual([]);
  expect(full.reason).toBe("full");
  expect(full.message).toContain("1h");
  expect((await slotsOf(request, d, [manicure])).slots).toEqual([at(d, "09:45")]); // 45 min cabe
});

test("dia sem atendimento e reservas fora do expediente são recusados", async ({ request }) => {
  await setHours(request, { bufferMinutes: 0, slotStepMinutes: 30, openMinutes: 540, closeMinutes: 1080 });
  const { manicure } = await services(request);
  const dom = sunday();

  const closed = await slotsOf(request, dom, [manicure]);
  expect(closed.reason).toBe("closed");
  expect(closed.message).toContain("Não atendemos");

  const wd = workday(4);
  expect((await book(request, [manicure], at(wd, "03:00"))).status()).toBe(400); // madrugada
  expect((await book(request, [manicure], at(wd, "17:30"))).status()).toBe(400); // termina às 18:15
  expect((await book(request, [manicure], at(dom, "10:00"))).status()).toBe(400); // domingo
  expect((await book(request, [manicure], at(wd, "17:15"))).status()).toBe(201); // termina às 18:00 em ponto
});

test("antecedência mínima em dias: amanhã fica indisponível com too_soon e a reserva é recusada", async ({ request }) => {
  await setHours(request, { minLeadDays: 2, bufferMinutes: 0, slotStepMinutes: 30, openMinutes: 540, closeMinutes: 1080, workDays: [0, 1, 2, 3, 4, 5, 6] });
  const { manicure } = await services(request);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const plus = (n: number) => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const tomorrow = await slotsOf(request, plus(1), [manicure]);
  expect(tomorrow.slots).toEqual([]);
  expect(tomorrow.reason).toBe("too_soon");
  expect(tomorrow.message).toContain("2 dias de antecedência");
  const ok = await slotsOf(request, plus(2), [manicure]);
  expect(ok.slots.length).toBeGreaterThan(0);
  // Mesmo forçando um horário de amanhã direto na API, o servidor recusa.
  const forced = await book(request, [manicure], `${plus(1)}T13:00:00.000Z`);
  expect(forced.status()).toBe(400);
  expect((await forced.json()).error).toContain("antecedência");
  const avail = await (await request.get(`/api/public/availability?serviceIds=${manicure}&days=4`)).json();
  expect(avail.days[1].reason).toBe("too_soon");
  expect(avail.days[2].available).toBe(true);
  await setHours(request, { minLeadDays: 0, workDays: [1, 2, 3, 4, 5, 6] });
});

test("manutenção: unhas faltando somam ao total e ao sinal (cálculo no servidor)", async ({ request }) => {
  await setHours(request, { minLeadDays: 0, bufferMinutes: 0, slotStepMinutes: 30, openMinutes: 540, closeMinutes: 1080, workDays: [0, 1, 2, 3, 4, 5, 6] });
  await request.post("/api/auth/login", { data: ADMIN });
  const created = await (await request.post("/api/admin/services", { data: { name: "Manutenção de gel (teste)", description: "", durationMin: 60, priceCents: 8000, missingNailPriceCents: 1000, active: true } })).json();
  const id = created.service.id as string;
  const { manicure } = await services(request);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const { slots } = await slotsOf(request, day, [id, manicure]);
  // 3 unhas faltando a R$ 10 = +R$ 30; a manicure não tem preço por unha, então o valor enviado para ela é ignorado.
  const res = await request.post("/api/public/bookings", { data: { serviceIds: [id, manicure], startsAt: slots[0], name: "Cliente Teste", phone: "11988887777", missingNails: { [id]: 3, [manicure]: 5 } } });
  expect(res.status()).toBe(201);
  const { token } = await res.json();
  const b = await (await request.get(`/api/public/bookings/${token}`)).json();
  expect(b.appointment.totalCents).toBe(8000 + 3000 + 4500);
  expect(b.appointment.depositCents).toBe(Math.round((8000 + 3000 + 4500) * 0.3));
  expect(b.appointment.items.find((i: { name: string }) => i.name.startsWith("Manutenção de gel")).name).toContain("3 unhas faltando");
  await request.delete(`/api/admin/services/${id}`);
  await setHours(request, { workDays: [1, 2, 3, 4, 5, 6] });
});
