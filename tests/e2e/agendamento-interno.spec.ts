import { expect, test } from "@playwright/test";
import { crc16 } from "../../lib/pix";
import { apiLogin, at, hhmm, login, prisma, todayLocal } from "./helpers";

try {
  process.loadEnvFile(".env");
} catch {}

// Agendamento interno (Agenda > Novo agendamento). Cenário: estúdio atende seg–sáb das 09:00 às 18:00, com antecedência
// mínima de 2 dias para a CLIENTE; hoje tem horário próprio (00:00–24:00) para o teste valer a qualquer hora do dia.
test.describe.configure({ mode: "serial" });

const today = todayLocal();
const localHour = Number(hhmm(new Date()).slice(0, 2));
const JOANA = { name: "Joana Interna", phone: "(11) 95555-1234", stored: "5511955551234" };
let original: Record<string, unknown> = {};
let originalOverride: { on: boolean; open: number; lunchStart: number | null; lunchEnd: number | null; close: number } | null = null;
let manutId = "";
let firstSlot = ""; // horário do 1º agendamento do dia (fica ocupado para os testes seguintes)

// Dia de atendimento (seg–sáb) e domingo a ~45 dias, longe dos outros testes.
function workday() {
  const d = new Date(Date.now() + 45 * 86400_000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function sunday() {
  const d = new Date(Date.now() + 45 * 86400_000);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
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
  // Sem sessão de WhatsApp: nada é enviado de verdade ("WhatsApp desconectado" é o caminho testado).
  await db.business.update({
    where: { id: "main" },
    data: {
      openMinutes: 540, closeMinutes: 1080, slotStepMinutes: 30, bufferMinutes: 0, minLeadDays: 2, workDays: [1, 2, 3, 4, 5, 6], schedule: {},
      depositPercent: 30, waSessionId: "", pixKey: "11144477735", pixName: "Studio Teste", pixCity: "Sao Paulo",
    },
  });
  originalOverride = await db.dayOverride.findUnique({ where: { date: today }, select: { on: true, open: true, lunchStart: true, lunchEnd: true, close: true } });
  const allDay = { on: true, open: 0, lunchStart: null, lunchEnd: null, close: 1440 };
  await db.dayOverride.upsert({ where: { date: today }, update: allDay, create: { date: today, ...allDay } });
  // Serviço de manutenção (preço por unha faltando); os de demonstração não têm.
  await db.service.deleteMany({ where: { name: "Manutenção QA" } });
  manutId = (await db.service.create({ data: { name: "Manutenção QA", description: "", durationMin: 60, priceCents: 8000, missingNailPriceCents: 1000 } })).id;
  await db.$disconnect();
});

test.afterAll(async () => {
  const db = await prisma();
  await db.messageLog.deleteMany();
  await db.payment.deleteMany();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany({ where: { name: "Manutenção QA" } });
  if (originalOverride) await db.dayOverride.update({ where: { date: today }, data: originalOverride });
  else await db.dayOverride.deleteMany({ where: { date: today } });
  await db.business.update({ where: { id: "main" }, data: original as never });
  await db.$disconnect();
});

test("popup: cliente nova, serviços com unha faltando, hoje, horário, resumo, Pix copia e cola, WhatsApp desconectado, sinal recebido e selo interno", async ({ page, context, request }) => {
  test.skip(localHour >= 19, "tarde demais para caber um atendimento ainda hoje");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("dialog", (d) => d.accept());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);

  // A CLIENTE não consegue agendar para hoje (antecedência de 2 dias); a dona consegue.
  const info = await (await request.get("/api/public/info")).json();
  const manicure = info.services.find((s: { name: string }) => s.name === "Manicure");
  const pub = await (await request.get(`/api/public/availability?serviceIds=${manicure.id}`)).json();
  expect(pub.days.find((d: { date: string }) => d.date === today).available).toBe(false);

  await page.goto("/admin/agenda");
  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo agendamento" });
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole("button", { name: "Salvar agendamento" });
  await expect(save).toBeDisabled();

  // 1) Cliente nova: a busca não acha ninguém e o número digitado já vai para o cadastro, com máscara.
  const search = dialog.getByLabel("WhatsApp ou nome da cliente");
  await expect(search).toBeFocused();
  await search.fill("11955");
  await expect(search).toHaveValue("(11) 955");
  await expect(dialog.getByText("Nenhuma cliente encontrada.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cadastrar cliente nova" }).click();
  await expect(dialog.getByLabel("WhatsApp (com DDD)")).toHaveValue("(11) 955");
  await dialog.getByLabel("Nome").fill(JOANA.name);
  await dialog.getByLabel("WhatsApp (com DDD)").fill("11955551234");
  await expect(dialog.getByLabel("WhatsApp (com DDD)")).toHaveValue(JOANA.phone);

  // 2) Serviços: seleção múltipla e bloco de unha faltando só no serviço de manutenção.
  await dialog.getByRole("button", { name: /Manicure/ }).click();
  await expect(dialog.getByText("Tem unha faltando?")).toHaveCount(0);
  await dialog.getByRole("button", { name: /Manutenção QA/ }).click();
  const nails = dialog.getByRole("group", { name: "Unha faltando em Manutenção QA" });
  await nails.getByRole("button", { name: "Sim" }).click();
  await dialog.getByRole("button", { name: "Mais uma unha" }).click();
  await expect(dialog.getByText("Quantas unhas?")).toBeVisible();

  // 3) Data: hoje está liberado para a dona.
  const todayCell = dialog.locator('[role="gridcell"][aria-current="date"]');
  await expect(todayCell).toBeEnabled();
  await todayCell.click();

  // 4) Horário: mesma grade (de 30 em 30 min); o primeiro de hoje respeita os 30 min de antecedência.
  const slots = dialog.getByRole("group", { name: "Horários" });
  await expect(slots.getByRole("button").first()).toBeVisible();
  firstSlot = (await slots.getByRole("button").first().textContent())!.trim();
  expect(firstSlot).toMatch(/^\d{2}:(00|30)$/);
  await slots.getByRole("button").first().click();

  // 5) Resumo: itens, unhas faltando, total, tempo estimado, sinal (30%) e restante.
  const summary = dialog.locator('[aria-label="Resumo da reserva"]');
  await expect(summary).toContainText(JOANA.name);
  await expect(summary).toContainText(`às ${firstSlot}`);
  await expect(summary).toContainText("Manicure");
  await expect(summary).toContainText("R$ 45,00");
  await expect(summary).toContainText("Manutenção QA");
  await expect(summary).toContainText("2 unhas faltando × R$ 10,00");
  await expect(summary).toContainText("+ R$ 20,00");
  await expect(summary).toContainText("tempo estimado 1h45");
  await expect(summary).toContainText("R$ 145,00");
  await expect(summary).toContainText("Sinal para reservar (30%)");
  await expect(summary).toContainText("R$ 43,50");
  await expect(summary).toContainText("o restante (R$ 101,50) no dia do atendimento");
  await dialog.getByLabel("Observações (opcional)").fill("Prefere esmalte claro");

  // Salvar: cria cliente, agendamento (origem ADMIN), itens e pagamento pendente com o Pix.
  await expect(save).toBeEnabled();
  await save.click();
  const done = page.getByRole("dialog", { name: "Agendamento criado" });
  await expect(done).toBeVisible();
  await expect(done).toContainText(JOANA.name);
  await expect(done).toContainText("+55 (11) 95555-1234");
  await expect(done).toContainText("Sinal: R$ 43,50");

  const db = await prisma();
  const appt = await db.appointment.findFirstOrThrow({ where: { customerId: JOANA.stored }, include: { items: true, payments: true, customer: true } });
  expect(appt.source).toBe("ADMIN");
  expect(appt.status).toBe("PENDING_PAYMENT");
  expect(appt.customer.name).toBe(JOANA.name);
  expect(appt.notes).toBe("Prefere esmalte claro");
  expect(hhmm(appt.startsAt)).toBe(firstSlot);
  expect(todayLocal()).toBe(new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(appt.startsAt));
  expect(appt.endsAt.getTime() - appt.startsAt.getTime()).toBe(105 * 60_000);
  expect(appt.totalCents).toBe(14500);
  expect(appt.depositCents).toBe(4350);
  expect(appt.items.map((i) => i.name).sort()).toEqual(["Manicure", "Manutenção QA (2 unhas faltando)"]);
  expect(appt.items.find((i) => i.serviceId === manutId)).toMatchObject({ priceCents: 10000, missingNails: 2, missingNailPriceCents: 1000 });
  expect(appt.payments).toHaveLength(1);
  expect(appt.payments[0]).toMatchObject({ status: "PENDING", amountCents: 4350 });

  // 6) Pix copia e cola: o mesmo payload gravado no pagamento, com valor do sinal e CRC válido.
  const pix = await done.getByLabel("Pix copia e cola do sinal").inputValue();
  expect(pix).toBe(appt.payments[0].pixPayload);
  expect(pix).toMatch(/^000201/);
  expect(pix).toContain("br.gov.bcb.pix");
  expect(pix).toContain("540543.50");
  expect(pix.slice(-4)).toBe(crc16(pix.slice(0, -4)));
  await done.getByRole("button", { name: "Copiar Pix copia e cola" }).click();
  await expect(page.getByText("Pix copia e cola copiado.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pix);

  // Enviar pelo WhatsApp com o WhatsApp desconectado: avisa, não quebra, e a tentativa fica no histórico.
  await done.getByRole("button", { name: "Enviar pelo WhatsApp" }).click();
  await expect(page.getByText(/O WhatsApp não está conectado: a mensagem não foi enviada/)).toBeVisible();
  const logs = await db.messageLog.findMany({ where: { appointmentId: appt.id } });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ direction: "OUT", status: "SKIPPED", phone: JOANA.stored });
  expect(logs[0].body).toContain("Total: R$");
  expect((await db.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("PENDING_PAYMENT");

  // Marcar sinal como já recebido: pagamento pago e agendamento confirmado (mesmo caminho de Pagamentos).
  await done.getByRole("button", { name: "Marcar sinal como já recebido" }).click();
  await expect(done.getByText("Sinal recebido. O agendamento está confirmado.")).toBeVisible();
  await expect(done.getByRole("button", { name: "Enviar pelo WhatsApp" })).toHaveCount(0);
  const after = await db.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: { payments: true } });
  expect(after.status).toBe("CONFIRMED");
  expect(after.payments[0].status).toBe("PAID");
  expect(after.payments[0].paidAt).toBeTruthy();
  await db.$disconnect();

  // Ao concluir, a agenda abre o dia com o atendimento criado e o selo "interno".
  await done.getByRole("button", { name: "Concluir" }).click();
  const day = page.getByRole("dialog");
  await expect(day).toContainText(JOANA.name);
  await expect(day).toContainText(firstSlot);
  await expect(day.getByText("interno", { exact: true })).toBeVisible();
  await expect(day.getByText("Confirmado").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("popup: autocomplete por nome e telefone, horário ocupado some, conflito 409 e horário fora da grade", async ({ page }) => {
  test.skip(localHour >= 19, "tarde demais para caber um atendimento ainda hoje");
  test.skip(!firstSlot, "depende do agendamento criado no teste anterior");
  await login(page);
  await page.goto("/admin/agenda");
  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo agendamento" });
  const search = dialog.getByLabel("WhatsApp ou nome da cliente");
  const found = dialog.getByRole("list", { name: "Clientes encontradas" });

  // Busca por trecho do nome (sem diferenciar maiúsculas) e por prefixo do telefone, com ou sem máscara.
  await search.fill("joana");
  await expect(found.getByRole("button")).toHaveCount(1);
  await expect(found).toContainText(JOANA.name);
  await expect(found).toContainText("+55 (11) 95555-1234");
  await search.fill("99");
  await expect(dialog.getByText("Nenhuma cliente encontrada.")).toBeVisible();
  await search.fill("1195555");
  await expect(found).toContainText(JOANA.name);
  await found.getByRole("button", { name: /Joana Interna/ }).click();
  await expect(dialog.getByRole("button", { name: "Trocar" })).toBeVisible();
  await expect(dialog.getByLabel("WhatsApp ou nome da cliente")).toHaveCount(0);

  await dialog.getByRole("button", { name: /Manicure/ }).click();
  await dialog.locator('[role="gridcell"][aria-current="date"]').click();
  const slots = dialog.getByRole("group", { name: "Horários" });
  await expect(slots.getByRole("button").first()).toBeVisible();
  // O horário já agendado (confirmado) não é mais oferecido.
  await expect(slots.getByRole("button", { name: firstSlot, exact: true })).toHaveCount(0);

  // Conflito: enquanto a dona preenche, outra reserva ocupa o horário escolhido → 409 na tela e a grade atualiza.
  const chosen = (await slots.getByRole("button").first().textContent())!.trim();
  await slots.getByRole("button", { name: chosen, exact: true }).click();
  const info = await (await page.request.get("/api/public/info")).json();
  const manicure = info.services.find((s: { name: string }) => s.name === "Manicure").id;
  const race = await page.request.post("/api/admin/appointments", { data: { serviceIds: [manicure], startsAt: at(today, chosen), name: "Outra Cliente", phone: "11944443333" } });
  expect(race.status()).toBe(201);
  await dialog.getByRole("button", { name: "Salvar agendamento" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Esse horário acabou de ser ocupado. Escolha outro.");
  await expect(slots.getByRole("button", { name: chosen, exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Salvar agendamento" })).toBeDisabled();

  // Horário fora da grade (encaixe): 23:10 não existe na grade de 30 em 30 minutos.
  await dialog.getByLabel("Horário fora da grade (encaixe)").check();
  await dialog.getByLabel("Horário fora da grade (HH:MM)").fill("23:10");
  await expect(dialog.locator('[aria-label="Resumo da reserva"]')).toContainText("às 23:10");
  await dialog.getByRole("button", { name: "Salvar agendamento" }).click();
  const done = page.getByRole("dialog", { name: "Agendamento criado" });
  await expect(done).toBeVisible();
  await expect(done).toContainText("Sinal: R$ 13,50");

  const db = await prisma();
  const manual = await db.appointment.findFirstOrThrow({ where: { customerId: JOANA.stored, status: "PENDING_PAYMENT" } });
  expect(manual.startsAt.toISOString()).toBe(at(today, "23:10"));
  expect(manual.source).toBe("ADMIN");
  // A cliente já cadastrada foi reaproveitada (não duplicou).
  expect(await db.customer.count({ where: { phone: JOANA.stored } })).toBe(1);
  await db.$disconnect();

  await done.getByRole("button", { name: "Concluir" }).click();
  const day = page.getByRole("dialog");
  await expect(day).toContainText("23:10");
  await expect(day.getByText("interno", { exact: true }).first()).toBeVisible();
});

test("popup aberto pelo dia da grade já vem com a data escolhida", async ({ page }) => {
  test.skip(localHour >= 19, "tarde demais para caber um atendimento ainda hoje");
  await login(page);
  await page.goto("/admin/agenda");
  await page.getByRole("button", { name: new RegExp(`^${today.slice(8)}/${today.slice(5, 7)}: \\d+ agendamento`) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Novo agendamento" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo agendamento" });
  await expect(dialog).toContainText("Data escolhida na agenda");
  await dialog.getByRole("button", { name: /Manicure/ }).click();
  // Sem clicar no calendário: o dia já está selecionado e os horários aparecem.
  await expect(dialog.locator('[role="gridcell"][aria-current="date"]')).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("group", { name: "Horários" }).getByRole("button").first()).toBeVisible();
});

test("API do agendamento interno: sessão, origem, conflito 409, horário fora da grade e regras que continuam valendo", async ({ request, playwright }) => {
  const W = workday();
  const S = sunday();
  const info = await (await request.get("/api/public/info")).json();
  const manicure = info.services.find((s: { name: string }) => s.name === "Manicure").id as string;
  const body = (startsAt: string, extra: Record<string, unknown> = {}) => ({ serviceIds: [manicure], startsAt, name: "Rita Api", phone: "11933330001", ...extra });

  // Sem sessão: 401 em todas as rotas novas do painel.
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect((await anon.post("/api/admin/appointments", { data: body(at(W, "10:00")) })).status()).toBe(401);
  expect((await anon.post("/api/admin/appointments/qualquer/send-pix")).status()).toBe(401);
  expect((await anon.get(`/api/admin/slots?date=${W}&serviceIds=${manicure}`)).status()).toBe(401);
  expect((await anon.get(`/api/admin/availability?serviceIds=${manicure}`)).status()).toBe(401);
  expect((await anon.get("/api/admin/customers?autocomplete=1&q=11")).status()).toBe(401);
  await anon.dispose();

  await apiLogin(request);
  // CSRF: POST vindo de outra origem é recusado mesmo com sessão.
  const csrf = await request.post("/api/admin/appointments", { data: body(at(W, "10:00")), headers: { origin: "https://evil.example" } });
  expect(csrf.status()).toBe(403);

  // Criação normal: 201 com o agendamento (origem ADMIN), o pagamento com o Pix e whatsappSent = false (nada é enviado sozinho).
  const created = await request.post("/api/admin/appointments", { data: body(at(W, "10:00")) });
  expect(created.status()).toBe(201);
  const c = await created.json();
  expect(c.appointment).toMatchObject({ source: "ADMIN", status: "PENDING_PAYMENT", startsAt: at(W, "10:00"), totalCents: 4500, depositCents: 1350 });
  expect(c.appointment.customer).toMatchObject({ name: "Rita Api", phone: "5511933330001" });
  expect(c.payment.amountCents).toBe(1350);
  expect(c.payment.pixPayload).toMatch(/^000201.*6304[0-9A-F]{4}$/);
  expect(c.whatsappSent).toBe(false);
  expect(Object.keys(c.payment).sort()).toEqual(["amountCents", "id", "pixPayload"]);

  // Conflito: o mesmo horário (ou um horário manual por cima dele) dá 409.
  const clash = await request.post("/api/admin/appointments", { data: body(at(W, "10:00"), { name: "Bia Api", phone: "11933330002" }) });
  expect(clash.status()).toBe(409);
  expect((await clash.json()).error).toBe("Esse horário acabou de ser ocupado. Escolha outro.");
  const overlap = await request.post("/api/admin/appointments", { data: body(at(W, "12:00"), { manualTime: "10:20", phone: "11933330002" }) });
  expect(overlap.status()).toBe(409);
  const before = await request.post("/api/admin/appointments", { data: body(at(W, "12:00"), { manualTime: "09:30", phone: "11933330002" }) });
  expect(before.status()).toBe(409); // 09:30–10:15 invade o atendimento das 10:00

  // Horário fora da grade: 07:10 é antes da abertura (09:00). Com manualTime vale; sem ele, não.
  const off = await request.post("/api/admin/appointments", { data: body(at(W, "12:00"), { manualTime: "07:10", name: "Encaixe Api", phone: "11933330003" }) });
  expect(off.status()).toBe(201);
  expect((await off.json()).appointment).toMatchObject({ startsAt: at(W, "07:10"), endsAt: at(W, "07:55"), source: "ADMIN" });
  const outside = await request.post("/api/admin/appointments", { data: body(at(W, "07:00"), { phone: "11933330004" }) });
  expect(outside.status()).toBe(400);
  expect((await outside.json()).error).toMatch(/fora do expediente/);

  // Mesmo fora da grade: dia fechado, passado e formato inválido continuam barrados.
  const closed = await request.post("/api/admin/appointments", { data: body(at(S, "12:00"), { manualTime: "10:00", phone: "11933330004" }) });
  expect(closed.status()).toBe(400);
  expect((await closed.json()).error).toMatch(/fechado neste dia/);
  const past = await request.post("/api/admin/appointments", { data: body(at(today, "12:00"), { manualTime: "00:00", phone: "11933330004" }) });
  expect(past.status()).toBe(400);
  expect((await past.json()).error).toBe("Horário no passado.");
  const yesterday = await request.post("/api/admin/appointments", { data: body(new Date(Date.now() - 86400_000).toISOString(), { manualTime: "23:59", phone: "11933330004" }) });
  expect(yesterday.status()).toBe(400);
  for (const manualTime of ["25:00", "7:10", "07:60", "07:10:00", "agora"]) {
    const bad = await request.post("/api/admin/appointments", { data: body(at(W, "12:00"), { manualTime, phone: "11933330004" }) });
    expect(bad.status(), manualTime).toBe(400);
    expect((await bad.json()).error).toBe("Dados inválidos.");
  }
  expect((await request.post("/api/admin/appointments", { data: body("amanhã cedo", { phone: "11933330004" }) })).status()).toBe(400);
  expect((await request.post("/api/admin/appointments", { data: body(at(W, "15:00"), { phone: "123" }) })).status()).toBe(400);
  expect((await request.post("/api/admin/appointments", { data: { ...body(at(W, "15:00")), serviceIds: ["nao-existe"] } })).status()).toBe(400);

  // allowToday: false devolve a antecedência mínima (2 dias) também para o painel.
  const tomorrow = await request.post("/api/admin/appointments", { data: body(new Date(Date.now() + 86400_000).toISOString(), { manualTime: "12:00", allowToday: false, phone: "11933330004" }) });
  expect(tomorrow.status()).toBe(400);

  // A rota PÚBLICA não ganha as liberdades da dona: ignora manualTime/allowToday/markDepositPaid.
  const pubToday = await request.post("/api/public/bookings", { data: body(new Date(Date.now() + 3600_000).toISOString(), { allowToday: true, manualTime: "23:30", phone: "11933330005" }) });
  expect(pubToday.status()).toBe(400);
  const pub = await request.post("/api/public/bookings", { data: body(at(W, "11:00"), { manualTime: "07:40", markDepositPaid: true, sendPix: true, source: "ADMIN", name: "Publica Api", phone: "11933330005" }) });
  expect(pub.status()).toBe(201);
  const db = await prisma();
  const pubAppt = await db.appointment.findFirstOrThrow({ where: { customerId: "5511933330005" }, include: { payments: true } });
  expect(pubAppt.startsAt.toISOString()).toBe(at(W, "11:00"));
  expect(pubAppt.source).toBe("PUBLIC");
  expect(pubAppt.status).toBe("PENDING_PAYMENT");
  expect(pubAppt.payments[0].status).toBe("PENDING");

  // markDepositPaid: já nasce confirmado e pago.
  const paid = await request.post("/api/admin/appointments", { data: body(at(W, "13:00"), { markDepositPaid: true, name: "Paga Api", phone: "11933330006" }) });
  expect(paid.status()).toBe(201);
  const p = await paid.json();
  expect(p.appointment.status).toBe("CONFIRMED");
  expect(p.appointment.payments[0].status).toBe("PAID");
  expect(p.whatsappSent).toBe(false);

  // sendPix com o WhatsApp desconectado: cria normalmente e informa whatsappSent = false; a tentativa fica no histórico.
  const sent = await request.post("/api/admin/appointments", { data: body(at(W, "14:00"), { sendPix: true, name: "Envio Api", phone: "11933330007" }) });
  expect(sent.status()).toBe(201);
  const s = await sent.json();
  expect(s.whatsappSent).toBe(false);
  expect(await db.messageLog.count({ where: { appointmentId: s.appointment.id, status: "SKIPPED" } })).toBe(1);

  // /send-pix: reenvio (200, false), sinal já pago (409) e id inexistente (404).
  const again = await request.post(`/api/admin/appointments/${s.appointment.id}/send-pix`);
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual({ whatsappSent: false });
  const logged = await db.messageLog.findMany({ where: { appointmentId: s.appointment.id } });
  expect(logged).toHaveLength(2);
  expect((await request.post(`/api/admin/appointments/${p.appointment.id}/send-pix`)).status()).toBe(409);
  expect((await request.post("/api/admin/appointments/nao-existe/send-pix")).status()).toBe(404);
  await db.$disconnect();

  // Horários do painel: os ocupados saem da grade; a lista de hoje existe para a dona e não para a cliente.
  const adminSlots = await (await request.get(`/api/admin/slots?date=${W}&serviceIds=${manicure}`)).json();
  for (const t of ["10:00", "11:00", "13:00", "14:00"]) expect(adminSlots.slots, t).not.toContain(at(W, t));
  expect(adminSlots.slots).toContain(at(W, "09:00"));
  expect(adminSlots.slots).toContain(at(W, "15:00"));
  const adminDays = await (await request.get(`/api/admin/availability?serviceIds=${manicure}&days=60`)).json();
  expect(adminDays.days[0].date).toBe(today);
  expect(adminDays.days.find((d: { date: string }) => d.date === S)).toMatchObject({ available: false, reason: "closed" });
  const pubSlots = await (await request.get(`/api/public/slots?date=${today}&serviceIds=${manicure}`)).json();
  expect(pubSlots.slots).toEqual([]);

  // Autocomplete: prefixo do telefone (com ou sem 55) ou trecho do nome, no máximo 8, vazio → nada.
  const q = async (v: string) => (await (await request.get(`/api/admin/customers?autocomplete=1&q=${encodeURIComponent(v)}`)).json()).customers as { name: string; phone: string }[];
  expect((await q("1193333")).length).toBe(5); // Rita, Encaixe, Publica, Paga e Envio (as recusadas não criam cliente)
  expect((await q("551193333")).length).toBe(5);
  expect((await q("(11) 93333-0003")).map((x) => x.name)).toEqual(["Encaixe Api"]);
  expect((await q("3333")).length).toBe(0); // telefone é por PREFIXO, não por trecho
  expect((await q("api")).length).toBe(5);
  expect((await q("encaixe")).map((x) => x.phone)).toEqual(["5511933330003"]);
  expect(await q("")).toEqual([]);
  for (let i = 0; i < 4; i++) await request.post("/api/admin/customers", { data: { phone: `1193333010${i}`, name: `Extra Api ${i}` } });
  expect((await q("1193333")).length).toBe(8);
  // A busca antiga da tela Clientes (sem autocomplete=1) segue por trecho do telefone.
  expect((await (await request.get("/api/admin/customers?q=33330003")).json()).customers).toHaveLength(1);
});
