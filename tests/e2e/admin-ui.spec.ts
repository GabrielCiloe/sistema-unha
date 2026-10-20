import { expect, test, type Page } from "@playwright/test";

const ADMIN = { email: "admin@local.test", password: "dev-password-12345" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Segurança: estes testes alteram dados (serviços, logo, cores, agenda). Só rodam no banco de testes.
test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127.0.0.1)[:/][^?]*_test/.test(url)) throw new Error("Testes e2e só rodam num banco local cujo nome termina em _test (npm run test:db:setup).");
  // Reservas precisam de chave Pix configurada.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.business.upsert({ where: { id: "main" }, update: { pixKey: "11144477735", pixName: "Studio Teste", pixCity: "Sao Paulo" }, create: { id: "main", name: "Meu Estúdio", confirmationTemplate: "Olá {cliente}! Confirmado.", reminderTemplate: "Lembrete {cliente}.", pixKey: "11144477735", pixName: "Studio Teste", pixCity: "Sao Paulo" } });
  await db.$disconnect();
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar" }).waitFor();
  await page.waitForTimeout(1500); // hidratação
  await page.getByLabel("E-mail").fill(ADMIN.email);
  await page.getByLabel("Senha").fill(ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("serviços: cards, popup de criar/editar e fechar com Esc", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/servicos");

  // Criar pelo popup
  await page.getByRole("button", { name: "Novo serviço" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Novo serviço" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nome")).toBeFocused();
  await dialog.getByLabel("Nome").fill("Spa dos pés teste");
  await dialog.getByLabel("Preço (R$)").fill("89,90");
  await dialog.getByLabel("Duração (min)").fill("75");
  await dialog.getByLabel("Descrição").fill("Esfoliação e hidratação");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  // Card com preço e duração
  const card = page.getByRole("listitem").filter({ hasText: "Spa dos pés teste" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("R$ 89,90");
  await expect(card).toContainText("75 min");

  // Editar pelo popup (campos já preenchidos) e cancelar com Esc sem salvar
  await card.getByRole("button", { name: /Editar/ }).click();
  const edit = page.getByRole("dialog", { name: "Editar serviço" });
  await expect(edit.getByLabel("Nome")).toHaveValue("Spa dos pés teste");
  await edit.getByLabel("Nome").fill("Nome que não deve salvar");
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();
  await expect(card).toBeVisible();

  // Desativar e excluir (limpeza)
  await card.getByRole("button", { name: "Desativar" }).click();
  await expect(card.getByText("Inativo")).toBeVisible();
  await card.getByRole("button", { name: /Excluir/ }).click();
  await expect(card).toBeHidden();
});

test("clientes: cards em grid e o WhatsApp é a chave primária", async ({ page, request }) => {
  // Cria uma cliente via reserva pública (dia distante para não colidir com outros testes).
  const info = await (await request.get("/api/public/info")).json();
  const svc = info.services[0];
  let startsAt: string | undefined;
  for (let d = 20; d < 60 && !startsAt; d++) {
    const date = new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
    startsAt = (await (await request.get(`/api/public/slots?date=${date}&serviceIds=${svc.id}`)).json()).slots[0];
  }
  expect(startsAt).toBeTruthy();
  const r = await request.post("/api/public/bookings", { data: { serviceIds: [svc.id], startsAt, name: "Camila Torres", phone: "(21) 98877-6655" } });
  expect(r.status()).toBe(201);

  await login(page);
  const list = await (await page.request.get("/api/admin/customers")).json();
  const camila = list.customers.find((c: { name: string }) => c.name === "Camila Torres");
  expect(camila.phone).toBe("5521988776655"); // PK = número normalizado
  expect(camila.id).toBeUndefined(); // não há mais id aleatório

  await page.goto("/admin/clientes");
  const card = page.getByRole("listitem").filter({ hasText: "Camila Torres" });
  await expect(card).toContainText("+55 (21) 98877-6655");
  await expect(card.getByRole("link", { name: /Conversar/ })).toHaveAttribute("href", "/admin/whatsapp?phone=5521988776655");

  // Mesmo número em outro formato reaproveita a mesma cliente (sem duplicar).
  await request.post("/api/public/bookings", { data: { serviceIds: [svc.id], startsAt: startsAt!, name: "Camila T.", phone: "5521988776655" } });
  const again = await (await page.request.get("/api/admin/customers?q=21988776655")).json();
  expect(again.customers).toHaveLength(1);

  // "Conversar" abre a conversa certa no painel.
  await card.getByRole("link", { name: /Conversar/ }).click();
  await expect(page).toHaveURL(/phone=5521988776655/);
  await expect(page.getByText("+5521988776655").first()).toBeVisible();
});

test("personalização: logo, cores aplicadas à página pública e proteção de contraste", async ({ page, browser }) => {
  await login(page);
  await page.goto("/admin/personalizacao");

  // Upload inválido (texto e SVG) é recusado; PNG válido é aceito.
  const input = page.locator("#logo-file");
  await input.setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("não sou imagem") });
  await expect(page.getByText("Envie PNG, JPG ou WebP.")).toBeVisible();
  await input.setInputFiles({
    name: "x.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(page.getByText("Envie PNG, JPG ou WebP.")).toBeVisible();
  // Regressão: enviar a logo não pode apagar o que foi digitado e ainda não foi salvo.
  await page.getByLabel("Frase de apresentação (aparece abaixo do nome)").fill("Texto ainda não salvo");
  await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Logo atualizada.")).toBeVisible();
  await expect(page.getByLabel("Frase de apresentação (aparece abaixo do nome)")).toHaveValue("Texto ainda não salvo");

  // Combinação ilegível: avisa e bloqueia o salvamento.
  await page.getByLabel("Texto", { exact: true }).fill("#111111");
  await expect(page.getByText(/pouco legível sobre a cor de fundo/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar personalização" })).toBeDisabled();
  await page.getByLabel("Texto", { exact: true }).fill("#ffffff");

  // Cores e frase válidas são salvas.
  await page.getByLabel("Frase de apresentação (aparece abaixo do nome)").fill("Unhas com carinho");
  await page.getByLabel("Botões principais", { exact: true }).fill("#ff0044");
  await page.getByLabel("Confirmação", { exact: true }).fill("#22aa55");
  await page.getByLabel("Fundo da página", { exact: true }).fill("#101820");
  await page.getByRole("button", { name: "Salvar personalização" }).click();
  await expect(page.getByText(/Personalização salva/)).toBeVisible();

  // Cliente (contexto sem login) vê logo, frase e cores já no HTML inicial.
  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  await pub.goto("/");
  await expect(pub.getByText("Unhas com carinho")).toBeVisible();
  const logo = pub.getByRole("img", { name: /^Logo de/ });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const vars = await pub.locator("div[style*='--color-brand']").first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { brand: s.getPropertyValue("--color-brand").trim(), confirm: s.getPropertyValue("--color-confirm").trim(), bg: s.backgroundColor };
  });
  expect(vars.brand).toBe("#ff0044");
  expect(vars.confirm).toBe("#22aa55");
  expect(vars.bg).toBe("rgb(16, 24, 32)");
  // A rota da logo serve imagem com cabeçalhos de segurança.
  const res = await pub.request.get((await logo.getAttribute("src"))!);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  await ctx.close();

  // O servidor também valida (não só a interface).
  const bad = await page.request.put("/api/admin/theme", {
    data: { tagline: "", themeBg: "#000000", themeSurface: "#000000", themeText: "#050505", themePrimary: "#ff0044", themeAccent: "#ec4899", themeConfirm: "#22aa55" },
  });
  expect(bad.status()).toBe(400);

  // Limpeza: restaura padrão e remove a logo.
  await page.getByRole("button", { name: "Restaurar cores padrão" }).click();
  await page.getByLabel("Frase de apresentação (aparece abaixo do nome)").fill("");
  await page.getByRole("button", { name: "Salvar personalização" }).click();
  await expect(page.getByText(/Personalização salva/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Remover/ }).click();
  await expect(page.locator("label[for=logo-file]")).toContainText("Enviar logo");
});

test("agenda: calendário, cancelamento pelo gestor e concluído automático", async ({ page, request }) => {
  page.on("dialog", (d) => d.accept());
  await login(page);

  // Reserva futura para o dia 3 do próximo mês de forma determinística (qualquer dia útil livre).
  const info = await (await request.get("/api/public/info")).json();
  const svc = info.services[0];
  let startsAt: string | undefined;
  for (let d = 70; d < 140 && !startsAt; d++) {
    const date = new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
    startsAt = (await (await request.get(`/api/public/slots?date=${date}&serviceIds=${svc.id}`)).json()).slots[0];
  }
  expect(startsAt).toBeTruthy();
  const created = await request.post("/api/public/bookings", { data: { serviceIds: [svc.id], startsAt, name: "Paula Reis", phone: "(31) 97766-5544" } });
  expect(created.status()).toBe(201);

  // Concluído automático: agendamento confirmado cujo horário já passou.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.customer.upsert({ where: { phone: "5531977665544" }, update: {}, create: { phone: "5531977665544", name: "Paula Reis" } });
  const past = await db.appointment.create({
    data: { customerId: "5531977665544", startsAt: new Date(Date.now() - 3 * 86400_000), endsAt: new Date(Date.now() - 3 * 86400_000 + 3600_000), status: "CONFIRMED", totalCents: 5000, depositCents: 1500 },
  });
  const range = `from=${encodeURIComponent(new Date(Date.now() - 10 * 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 1 * 86400_000).toISOString())}`;
  const listed = await (await page.request.get(`/api/admin/appointments?${range}`)).json();
  expect(listed.appointments.find((a: { id: string }) => a.id === past.id).status).toBe("COMPLETED");

  // Regras do PATCH: gestor não escolhe "concluído"; falta só depois do horário.
  const id = (await (await page.request.get(`/api/admin/appointments?from=${encodeURIComponent(startsAt!)}&to=${encodeURIComponent(new Date(new Date(startsAt!).getTime() + 3600_000).toISOString())}`)).json()).appointments[0].id;
  expect((await page.request.patch(`/api/admin/appointments/${id}`, { data: { status: "COMPLETED" } })).status()).toBe(400);
  expect((await page.request.patch(`/api/admin/appointments/${past.id}`, { data: { status: "CANCELLED" } })).status()).toBe(409);
  expect((await page.request.patch(`/api/admin/appointments/${past.id}`, { data: { status: "NO_SHOW" } })).status()).toBe(200);

  // Calendário: navega até o mês da reserva, abre o dia e cancela pelo popup.
  await page.goto("/admin/agenda");
  const target = new Date(startsAt!);
  const nowD = new Date();
  const months = (target.getUTCFullYear() - nowD.getUTCFullYear()) * 12 + (target.getUTCMonth() - nowD.getUTCMonth());
  for (let i = 0; i < months; i++) await page.getByRole("button", { name: "Próximo mês" }).click();
  const dayNum = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(target);
  const cell = page.getByRole("button", { name: `${dayNum.slice(8)}/${dayNum.slice(5, 7)}: 1 agendamento(s)` });
  await expect(cell).toBeVisible();
  await expect(cell).toContainText("Paula");
  await cell.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Paula Reis");
  await expect(dialog).toContainText("(31) 97766-5544");
  await dialog.getByRole("button", { name: "Cancelar agendamento" }).click();
  await expect(dialog.getByText("Cancelado").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar agendamento" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Filtro "Cancelados" mostra só o cancelado; "Confirmados" não mostra mais.
  await page.getByRole("button", { name: "Cancelados" }).click();
  await expect(page.getByRole("button", { name: `${dayNum.slice(8)}/${dayNum.slice(5, 7)}: 1 agendamento(s)` })).toBeVisible();
  await page.getByRole("button", { name: "Confirmados" }).click();
  await expect(page.getByRole("button", { name: `${dayNum.slice(8)}/${dayNum.slice(5, 7)}: 0 agendamento(s)` })).toBeVisible();

  await db.appointment.delete({ where: { id: past.id } });
  await db.$disconnect();
});

test("visão geral: números em destaque e próximos atendimentos em cards", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Atendimentos hoje")).toBeVisible();
  const big = page.locator("p.text-3xl.font-bold").first();
  await expect(big).toBeVisible();
  expect(await big.evaluate((e) => getComputedStyle(e).fontWeight)).toBe("700");
  // Cartão da estatística: número à esquerda e ícone à direita na mesma linha.
  const stat = page.locator("div.card", { hasText: "Atendimentos hoje" }).first();
  const [n, icon] = await Promise.all([stat.locator("p.text-3xl").boundingBox(), stat.locator("span[aria-hidden]").boundingBox()]);
  expect(icon!.x).toBeGreaterThan(n!.x + n!.width);
  expect(Math.abs((icon!.y + icon!.height / 2) - (n!.y + n!.height / 2))).toBeLessThan(40);
});
