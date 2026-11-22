import { expect, test } from "@playwright/test";
import { crc16 } from "../../lib/pix";
import { at, prisma, todayLocal } from "./helpers";

try {
  process.loadEnvFile(".env");
} catch {}

// Página da cliente (pública): o fluxo de reserva continua igual depois do agendamento interno.
// Este teste roda sem alterações em `main` e na branch da entrega: serve de comparação de comportamento.
const today = todayLocal();
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
let original: Record<string, unknown> = {};

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
  await db.business.update({
    where: { id: "main" },
    data: {
      openMinutes: 540, closeMinutes: 1080, slotStepMinutes: 30, bufferMinutes: 0, minLeadDays: 2, workDays: [1, 2, 3, 4, 5, 6], schedule: {},
      depositPercent: 30, waSessionId: "", pixKey: "11144477735", pixName: "Studio Teste", pixCity: "Sao Paulo",
    },
  });
  await db.dayOverride.deleteMany({ where: { date: { gte: today } } });
  await db.service.deleteMany({ where: { name: "Manutenção QA" } });
  await db.service.create({ data: { name: "Manutenção QA", description: "", durationMin: 60, priceCents: 8000, missingNailPriceCents: 1000 } });
  await db.$disconnect();
});

test.afterAll(async () => {
  const db = await prisma();
  await db.messageLog.deleteMany();
  await db.payment.deleteMany();
  await db.appointment.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany({ where: { name: "Manutenção QA" } });
  await db.business.update({ where: { id: "main" }, data: original as never });
  await db.$disconnect();
});

test("cliente: serviços, unha faltando, data com antecedência, horário, resumo, reserva e Pix do sinal", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  // 1) Serviços (seleção múltipla) e bloco de unha faltando só na manutenção.
  await page.getByRole("button", { name: /Manicure/ }).click();
  await expect(page.getByText("Tem unha faltando?")).toHaveCount(0);
  await page.getByRole("button", { name: /Manutenção QA/ }).click();
  await page.getByRole("group", { name: "Unha faltando em Manutenção QA" }).getByRole("button", { name: "Sim" }).click();
  await page.getByRole("button", { name: "Mais uma unha" }).click();

  // 2) Data: hoje e amanhã ficam bloqueados pela antecedência mínima (2 dias); a cliente não tem "horário fora da grade".
  const grid = page.getByRole("grid", { name: "Calendário" });
  await expect(grid.locator('[role="gridcell"][aria-current="date"]')).toBeDisabled();
  await expect(page.getByText("Horário fora da grade")).toHaveCount(0);
  await grid.locator('[role="gridcell"]:not([disabled])').first().click();

  // 3) Horário: grade de 30 em 30 minutos a partir da abertura.
  const slots = page.getByRole("group", { name: "Horários" });
  await expect(slots.getByRole("button").first()).toHaveText("09:00");
  await expect(slots.getByRole("button").nth(1)).toHaveText("09:30");
  await slots.getByRole("button").first().click();

  // 4) Dados e resumo.
  await page.getByLabel(/^Nome/).fill("Maria Cliente");
  await page.locator("#phone").fill("11912345678");
  await expect(page.locator("#phone")).toHaveValue("(11) 91234-5678");
  const summary = page.locator('[aria-label="Resumo da reserva"]');
  await expect(summary).toContainText("Manicure · 45 min");
  await expect(summary).toContainText("Manutenção QA · 1h");
  await expect(summary).toContainText("2 unhas faltando × R$ 10,00");
  await expect(summary).toContainText("tempo estimado 1h45");
  await expect(summary).toContainText("R$ 145,00");
  await expect(summary).toContainText("Sinal para reservar (30%)");
  await expect(summary).toContainText("R$ 43,50");
  await expect(summary).toContainText("O sinal é pago agora por Pix; o restante (R$ 101,50) no dia do atendimento.");

  // 5) Reserva: vai para a página da reserva com o Pix do sinal.
  await page.getByRole("button", { name: "Reservar e pagar o sinal" }).click();
  await expect(page).toHaveURL(/\/reserva\//);
  await expect(page.getByText("Pague o sinal: R$ 43,50")).toBeVisible();
  await expect(page.getByRole("button", { name: /Copiar Pix/ })).toBeVisible();

  const db = await prisma();
  const appt = await db.appointment.findFirstOrThrow({ where: { customerId: "5511912345678" }, include: { items: true, payments: true, customer: true } });
  expect(appt.status).toBe("PENDING_PAYMENT");
  expect(appt.customer.name).toBe("Maria Cliente");
  expect(appt.totalCents).toBe(14500);
  expect(appt.depositCents).toBe(4350);
  expect(appt.items.map((i) => i.name).sort()).toEqual(["Manicure", "Manutenção QA (2 unhas faltando)"]);
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(appt.startsAt);
  expect(day >= addDays(today, 2)).toBe(true);
  expect(appt.startsAt.toISOString()).toBe(at(day, "09:00"));
  expect(appt.payments).toHaveLength(1);
  expect(appt.payments[0].status).toBe("PENDING");
  const pix = appt.payments[0].pixPayload!;
  expect(pix).toContain("540543.50");
  expect(pix.slice(-4)).toBe(crc16(pix.slice(0, -4)));
  // Origem da reserva (coluna nova): a da cliente é sempre PUBLIC.
  const [{ source }] = await db.$queryRaw<{ source: string }[]>`SELECT "source"::text AS source FROM "Appointment" WHERE id = ${appt.id}`;
  expect(source).toBe("PUBLIC");
  // Nada é enviado à cliente ao reservar (só depois da aprovação do comprovante).
  expect(await db.messageLog.count()).toBe(0);
  await db.$disconnect();

  // Regras do servidor para a cliente: hoje e amanhã sem horários; reserva direta para amanhã é recusada; horário ocupado dá 409.
  const info = await (await request.get("/api/public/info")).json();
  const manicure = info.services.find((s: { name: string }) => s.name === "Manicure").id;
  expect((await (await request.get(`/api/public/slots?date=${today}&serviceIds=${manicure}`)).json()).slots).toEqual([]);
  expect((await (await request.get(`/api/public/slots?date=${addDays(today, 1)}&serviceIds=${manicure}`)).json()).slots).toEqual([]);
  const body = { serviceIds: [manicure], name: "Outra Cliente", phone: "11988887777" };
  expect((await request.post("/api/public/bookings", { data: { ...body, startsAt: at(addDays(today, 1), "10:00") } })).status()).toBe(400);
  expect((await request.post("/api/public/bookings", { data: { ...body, startsAt: at(day, "09:30") } })).status()).toBe(409);
  expect((await request.post("/api/public/bookings", { data: { ...body, startsAt: at(day, "07:00") } })).status()).toBe(400);
  const ok = await request.post("/api/public/bookings", { data: { ...body, startsAt: at(day, "11:00") } });
  expect(ok.status()).toBe(201);
  expect(Object.keys(await ok.json()).sort()).toEqual(["paymentStatus", "token"]);
  expect(errors).toEqual([]);
});
