import { expect, test } from "@playwright/test";
import { ADMIN, apiLogin, freshIp, hashPassword, login, prisma } from "./helpers";

try {
  process.loadEnvFile(".env");
} catch {}

// Configurações > Usuários com acesso ao painel: criar, editar, redefinir senha e remover, com as travas.
const NEW = { name: "Ana Recepção", email: "qa-ana@local.test" };

test.beforeAll(async () => {
  const db = await prisma();
  await db.user.deleteMany({ where: { email: { startsWith: "qa-" } } });
  await db.business.updateMany({ where: { id: "main" }, data: { waSessionId: "" } }); // nada é enviado de verdade
  await db.$disconnect();
});

test.afterAll(async () => {
  const db = await prisma();
  await db.user.deleteMany({ where: { email: { startsWith: "qa-" } } });
  await db.$disconnect();
});

test("usuários pela tela: criar (senha inicial uma vez), editar, redefinir senha, remover e travas", async ({ page, browser, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/configuracoes");
  const card = page.getByRole("region", { name: "Usuários com acesso ao painel" });
  const row = (text: string) => card.getByRole("listitem").filter({ hasText: text });

  // A própria conta aparece marcada e não pode ser removida.
  const mine = row(ADMIN.email);
  await expect(mine.getByText("você", { exact: true })).toBeVisible();
  await expect(mine.getByRole("button", { name: /^Remover / })).toBeDisabled();
  await expect(mine.getByRole("button", { name: /^Remover / })).toHaveAttribute("title", "Você não pode remover o seu próprio acesso.");

  // Criar: a senha inicial é gerada pelo sistema e aparece uma única vez.
  await card.getByRole("button", { name: "Criar usuário" }).click();
  const create = page.getByRole("dialog", { name: "Criar usuário" });
  await create.getByLabel("Nome").fill(NEW.name);
  await create.getByLabel("E-mail de login").fill("QA-Ana@Local.test"); // normalizado para minúsculas
  await create.getByRole("button", { name: "Criar usuário" }).click();
  const createdDialog = page.getByRole("dialog", { name: "Usuário criado" });
  await expect(createdDialog).toContainText(NEW.email);
  const initial = await createdDialog.getByLabel("Senha inicial").inputValue();
  expect(initial).toMatch(/^[A-Za-z0-9]{14}$/);
  expect(initial).toMatch(/[A-Za-z]/);
  expect(initial).toMatch(/\d/);
  await createdDialog.getByRole("button", { name: "Copiar senha" }).click();
  await expect(page.getByText("Senha copiada.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(initial);
  await createdDialog.getByRole("button", { name: "Fechar", exact: true }).last().click();
  await expect(createdDialog).toBeHidden();
  await expect(row(NEW.email)).toContainText(NEW.name);
  await expect(row(NEW.email)).toContainText("Última sessão: nenhuma ativa");

  // No banco fica só o hash; a pessoa entra com a senha inicial.
  const db = await prisma();
  const stored = await db.user.findUniqueOrThrow({ where: { email: NEW.email } });
  expect(stored.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  expect(stored.passwordHash).not.toContain(initial);
  const ana = await browser.newContext();
  await apiLogin(ana.request, { email: NEW.email, password: initial });
  expect((await ana.request.get("/api/admin/dashboard")).status()).toBe(200);

  // E-mail repetido: erro amigável no popup.
  await card.getByRole("button", { name: "Criar usuário" }).click();
  await create.getByLabel("Nome").fill("Outra Ana");
  await create.getByLabel("E-mail de login").fill(NEW.email);
  await create.getByRole("button", { name: "Criar usuário" }).click();
  await expect(create.getByRole("alert")).toHaveText("Já existe um usuário com este e-mail.");
  await create.getByRole("button", { name: "Cancelar" }).click();

  // Editar nome e e-mail.
  await row(NEW.email).getByRole("button", { name: `Editar ${NEW.name}` }).click();
  const edit = page.getByRole("dialog", { name: "Editar usuário" });
  await expect(edit.getByLabel("Nome")).toHaveValue(NEW.name);
  await edit.getByLabel("Nome").fill("Ana Paula");
  await edit.getByLabel("E-mail de login").fill("qa-ana.paula@local.test");
  await edit.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Usuário atualizado.")).toBeVisible();
  await expect(row("qa-ana.paula@local.test")).toContainText("Ana Paula");
  await expect(row("qa-ana.paula@local.test")).toContainText(/Última sessão: \d{2}\/\d{2}\/\d{4}/); // a sessão aberta acima

  // Redefinir senha: gera o link (30 min, uso único) e mostra para copiar.
  await row("qa-ana.paula@local.test").getByRole("button", { name: "Redefinir senha de Ana Paula" }).click();
  const reset = page.getByRole("dialog", { name: "Redefinir senha" });
  await reset.getByRole("button", { name: "Gerar link", exact: true }).click();
  const link = await reset.getByLabel("Link de redefinição de Ana Paula").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:3100\/login\/redefinir\?token=[A-Za-z0-9_-]{43}$/);
  await reset.getByRole("button", { name: "Fechar", exact: true }).last().click();
  // "Gerar e enviar para o WhatsApp do estúdio" com o WhatsApp desconectado: avisa e ainda mostra o link.
  await row("qa-ana.paula@local.test").getByRole("button", { name: "Redefinir senha de Ana Paula" }).click();
  await reset.getByRole("button", { name: "Gerar e enviar para o WhatsApp do estúdio" }).click();
  await expect(reset.getByRole("status")).toContainText("Não foi possível enviar pelo WhatsApp");
  const link2 = await reset.getByLabel("Link de redefinição de Ana Paula").inputValue();
  expect(link2).not.toBe(link);
  await reset.getByRole("button", { name: "Fechar", exact: true }).last().click();
  expect(await db.messageLog.count({ where: { body: { contains: "redefinir?token=" } } })).toBe(0); // o histórico não guarda o link

  // O segundo link cancelou o primeiro; com ele a pessoa cria a senha nova e a sessão antiga cai.
  const token = (l: string) => new URL(l).searchParams.get("token")!;
  expect((await ana.request.post("/api/auth/reset", { data: { token: token(link), password: "AnaPaula2031" }, headers: freshIp() })).status()).toBe(400);
  expect((await ana.request.post("/api/auth/reset", { data: { token: token(link2), password: "AnaPaula2031" }, headers: freshIp() })).status()).toBe(204);
  expect((await ana.request.get("/api/admin/dashboard")).status()).toBe(401);
  await apiLogin(ana.request, { email: "qa-ana.paula@local.test", password: "AnaPaula2031" });

  // Remover: pede confirmação, some da lista e a pessoa é desconectada na hora.
  await row("qa-ana.paula@local.test").getByRole("button", { name: "Remover Ana Paula" }).click();
  await expect(page.getByText("Acesso removido.")).toBeVisible();
  await expect(row("qa-ana.paula@local.test")).toHaveCount(0);
  expect((await ana.request.get("/api/admin/dashboard")).status()).toBe(401);
  expect((await ana.request.post("/api/auth/login", { data: { email: "qa-ana.paula@local.test", password: "AnaPaula2031" }, headers: freshIp() })).status()).toBe(401);
  expect(await db.user.count({ where: { email: { startsWith: "qa-ana" } } })).toBe(0);
  expect(await db.session.count({ where: { userId: stored.id } })).toBe(0);
  expect(await db.passwordReset.count({ where: { userId: stored.id } })).toBe(0);
  await db.$disconnect();
  await ana.close();
});

test("API de usuários: exige sessão, não devolve hash, valida entradas e aplica as travas", async ({ request, playwright }) => {
  const db = await prisma();
  const target = await db.user.create({ data: { name: "QA Alvo", email: "qa-alvo@local.test", passwordHash: hashPassword("Alvo12345678") } });

  // Sem sessão: 401 em tudo.
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect((await anon.get("/api/admin/users")).status()).toBe(401);
  expect((await anon.post("/api/admin/users", { data: { name: "Intruso", email: "qa-intruso@local.test" } })).status()).toBe(401);
  expect((await anon.patch(`/api/admin/users/${target.id}`, { data: { email: "qa-tomado@local.test" } })).status()).toBe(401);
  expect((await anon.delete(`/api/admin/users/${target.id}`)).status()).toBe(401);
  expect((await anon.post(`/api/admin/users/${target.id}/reset-link`, { data: {} })).status()).toBe(401);
  await anon.dispose();
  expect(await db.user.count({ where: { email: "qa-intruso@local.test" } })).toBe(0);

  await apiLogin(request);
  // Listagem: só id, nome, e-mail, datas. Nunca passwordHash/tokenHash.
  const list = await request.get("/api/admin/users");
  const listText = await list.text();
  expect(listText).not.toMatch(/passwordHash|tokenHash|[0-9a-f]{32}:[0-9a-f]{128}/);
  const { users, currentUserId } = JSON.parse(listText) as { users: Record<string, unknown>[]; currentUserId: string };
  for (const u of users) expect(Object.keys(u).sort()).toEqual(["createdAt", "email", "id", "lastSessionAt", "name"]);
  expect(users.find((u) => u.id === currentUserId)).toMatchObject({ email: ADMIN.email });

  // Criar: valida entradas; a senha do formulário é ignorada (sempre gerada pelo servidor); e-mail repetido → 409.
  expect((await request.post("/api/admin/users", { data: { name: "A", email: "qa-x@local.test" } })).status()).toBe(400);
  expect((await request.post("/api/admin/users", { data: { name: "Sem Email", email: "nao-e-email" } })).status()).toBe(400);
  expect((await request.post("/api/admin/users", { data: { name: "Dup", email: "QA-ALVO@local.test" } })).status()).toBe(409);
  expect((await request.post("/api/admin/users", { data: { name: "CSRF", email: "qa-csrf@local.test" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  const made = await request.post("/api/admin/users", { data: { name: "QA Criada", email: "qa-criada@local.test", password: "Escolhida123", passwordHash: "x" } });
  expect(made.status()).toBe(201);
  const m = await made.json();
  expect(Object.keys(m).sort()).toEqual(["password", "user"]);
  expect(m.password).not.toBe("Escolhida123");
  expect(JSON.stringify(m)).not.toMatch(/passwordHash/);
  const fresh = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect((await fresh.post("/api/auth/login", { data: { email: "qa-criada@local.test", password: "Escolhida123" }, headers: freshIp() })).status()).toBe(401);
  expect((await fresh.post("/api/auth/login", { data: { email: "qa-criada@local.test", password: m.password }, headers: freshIp() })).status()).toBe(200);

  // Editar: só nome/e-mail; corpo vazio ou só com passwordHash → 400; id inexistente → 404; e-mail de outro → 409.
  expect((await request.patch(`/api/admin/users/${target.id}`, { data: {} })).status()).toBe(400);
  expect((await request.patch(`/api/admin/users/${target.id}`, { data: { passwordHash: "x" } })).status()).toBe(400);
  expect((await request.patch("/api/admin/users/nao-existe", { data: { name: "Fantasma" } })).status()).toBe(404);
  expect((await request.patch(`/api/admin/users/${target.id}`, { data: { email: ADMIN.email } })).status()).toBe(409);
  const before = (await db.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash;
  const patched = await request.patch(`/api/admin/users/${target.id}`, { data: { name: "QA Alvo Editado", passwordHash: "injetado", id: "outro-id" } });
  expect(patched.status()).toBe(200);
  expect(Object.keys((await patched.json()).user).sort()).toEqual(["createdAt", "email", "id", "name"]);
  const afterPatch = await db.user.findUniqueOrThrow({ where: { id: target.id } });
  expect(afterPatch.name).toBe("QA Alvo Editado");
  expect(afterPatch.passwordHash).toBe(before); // a senha não muda pelo PATCH

  // Link de redefinição: id inexistente → 404; `send` precisa ser booleano.
  expect((await request.post("/api/admin/users/nao-existe/reset-link", { data: {} })).status()).toBe(404);
  expect((await request.post(`/api/admin/users/${target.id}/reset-link`, { data: { send: "sim" } })).status()).toBe(400);

  // Remover: não remove a si mesma, id inexistente → 404, outra origem → 403; remover de verdade → 204 e a sessão cai.
  const self = await request.delete(`/api/admin/users/${currentUserId}`);
  expect(self.status()).toBe(400);
  expect((await self.json()).error).toBe("Você não pode remover o seu próprio acesso.");
  expect((await request.delete("/api/admin/users/nao-existe")).status()).toBe(404);
  expect((await request.delete(`/api/admin/users/${m.user.id}`, { headers: { origin: "https://evil.example" } })).status()).toBe(403);
  expect((await fresh.get("/api/admin/dashboard")).status()).toBe(200);
  expect((await request.delete(`/api/admin/users/${m.user.id}`)).status()).toBe(204);
  expect((await fresh.get("/api/admin/dashboard")).status()).toBe(401);
  expect((await request.delete(`/api/admin/users/${m.user.id}`)).status()).toBe(404);
  expect((await request.get("/api/admin/dashboard")).status()).toBe(200); // a administradora segue logada
  await fresh.dispose();
  await db.$disconnect();
});

test("trocar o e-mail de um usuário cancela o link de redefinição pendente; trocar só o nome, não", async ({ request, playwright }) => {
  const db = await prisma();
  const target = await db.user.create({ data: { name: "QA Link", email: "qa-link@local.test", passwordHash: hashPassword("Link12345678") } });
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  await apiLogin(request);
  const path = `/api/admin/users/${target.id}`;
  const issue = async () => new URL((await (await request.post(`${path}/reset-link`, { data: {} })).json()).link).searchParams.get("token")!;
  const reset = (token: string) => anon.post("/api/auth/reset", { data: { token, password: "NovaLink2031" }, headers: freshIp() });
  const tryLogin = async (email: string) => (await anon.post("/api/auth/login", { data: { email, password: "Link12345678" }, headers: freshIp() })).status();

  // Gera o link e troca o e-mail: o link antigo deixa de valer (400) e a senha não muda.
  const old = await issue();
  expect(await db.passwordReset.count({ where: { userId: target.id } })).toBe(1);
  expect((await request.patch(path, { data: { email: "qa-link-novo@local.test" } })).status()).toBe(200);
  expect(await db.passwordReset.count({ where: { userId: target.id } })).toBe(0);
  const denied = await reset(old);
  expect(denied.status()).toBe(400);
  expect((await denied.json()).error).toMatch(/Link inválido ou expirado/);
  expect(await tryLogin("qa-link-novo@local.test")).toBe(200);
  expect(await tryLogin("qa-link@local.test")).toBe(401);

  // Trocar só o nome (ou repetir o mesmo e-mail) mantém o link pendente; e-mail recusado (409) também não o apaga.
  const kept = await issue();
  expect((await request.patch(path, { data: { name: "QA Link Renomeado" } })).status()).toBe(200);
  expect((await request.patch(path, { data: { email: "QA-Link-Novo@local.test" } })).status()).toBe(200);
  expect((await request.patch(path, { data: { email: ADMIN.email } })).status()).toBe(409);
  expect(await db.passwordReset.count({ where: { userId: target.id } })).toBe(1);
  expect((await reset(kept)).status()).toBe(204);
  await anon.dispose();
  await db.$disconnect();
});
