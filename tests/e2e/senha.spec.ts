import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiLogin, freshIp, hashPassword, login, newToken, prisma, sha256 } from "./helpers";

try {
  process.loadEnvFile(".env");
} catch {}

// Gestão de senha: trocar a própria senha, "Esqueci minha senha" → redefinir → login, e as regras do token.
// Usa usuários próprios (qa-*@local.test); o administrador dos outros testes não é alterado.
const PW = "Inicial12345";
const users = {
  troca: { email: "qa-troca@local.test", name: "QA Troca" },
  guarda: { email: "qa-guarda@local.test", name: "QA Guarda" },
  esqueci: { email: "qa-esqueci@local.test", name: "QA Esqueci" },
  token: { email: "qa-token@local.test", name: "QA Token" },
};
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const db = await prisma();
  await db.user.deleteMany({ where: { email: { startsWith: "qa-" } } });
  for (const [k, u] of Object.entries(users)) ids[k] = (await db.user.create({ data: { ...u, passwordHash: hashPassword(PW) } })).id;
  await db.$disconnect();
});

test.afterAll(async () => {
  const db = await prisma();
  await db.user.deleteMany({ where: { email: { startsWith: "qa-" } } });
  await db.$disconnect();
});

const me = async (r: APIRequestContext) => (await (await r.get("/api/auth/me")).json()).user as { email: string } | null;
const tryLogin = async (r: APIRequestContext, email: string, password: string) => (await r.post("/api/auth/login", { data: { email, password }, headers: freshIp() })).status();

test("trocar a própria senha: valida a atual, aplica a política, mantém esta sessão e derruba as outras", async ({ page, browser }) => {
  const u = { email: users.troca.email, password: PW };
  // Outro aparelho logado com o mesmo acesso.
  const other = await browser.newContext();
  await apiLogin(other.request, u);
  expect(await me(other.request)).toMatchObject({ email: u.email });

  await login(page, u);
  await page.goto("/admin/configuracoes");
  const card = page.getByRole("region", { name: "Acesso e senha" });
  await expect(card.getByLabel("E-mail de login")).toHaveValue(u.email);
  await expect(card.getByLabel("E-mail de login")).not.toBeEditable();
  const current = card.getByLabel("Senha atual");
  const next = card.getByLabel("Nova senha", { exact: true });
  const confirm = card.getByLabel("Confirmar nova senha");
  const submit = card.getByRole("button", { name: "Trocar senha" });

  // Política: mínimo de 8 caracteres, com letra e número.
  await current.fill(PW);
  await next.fill("curta1");
  await confirm.fill("curta1");
  await submit.click();
  await expect(card.getByRole("alert")).toContainText("pelo menos 8 caracteres");
  await next.fill("somenteletras");
  await confirm.fill("somenteletras");
  await submit.click();
  await expect(card.getByRole("alert")).toContainText("pelo menos um número");
  // Confirmação diferente.
  await next.fill("NovaSenha2031");
  await confirm.fill("NovaSenha2032");
  await submit.click();
  await expect(card.getByRole("alert")).toContainText("A confirmação não confere");
  // Senha atual errada.
  await current.fill("nao-e-a-senha");
  await confirm.fill("NovaSenha2031");
  await submit.click();
  await expect(card.getByRole("alert")).toHaveText("Senha atual incorreta.");
  expect(await me(other.request)).not.toBeNull(); // nada mudou ainda

  // Troca de verdade.
  await current.fill(PW);
  await submit.click();
  await expect(page.getByText("Senha alterada. Os outros aparelhos foram desconectados.")).toBeVisible();
  await expect(current).toHaveValue("");

  // Esta sessão continua; a do outro aparelho caiu.
  expect(await me(page.request)).toMatchObject({ email: u.email });
  expect((await page.request.get("/api/admin/dashboard")).status()).toBe(200);
  expect(await me(other.request)).toBeNull();
  expect((await other.request.get("/api/admin/dashboard")).status()).toBe(401);

  // A senha antiga não entra mais; a nova entra.
  expect(await tryLogin(other.request, u.email, PW)).toBe(401);
  expect(await tryLogin(other.request, u.email, "NovaSenha2031")).toBe(200);

  // Só o hash novo fica no banco.
  const db = await prisma();
  const row = await db.user.findUniqueOrThrow({ where: { id: ids.troca } });
  expect(row.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  expect(row.passwordHash).not.toContain("NovaSenha2031");
  await db.$disconnect();
  await other.close();
});

test("trocar senha pela API: exige sessão, nova diferente da atual e bloqueia após 5 senhas atuais erradas", async ({ request, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect((await anon.post("/api/auth/change-password", { data: { currentPassword: PW, newPassword: "NovaSenha2031" } })).status()).toBe(401);
  await anon.dispose();

  await apiLogin(request, { email: users.guarda.email, password: PW });
  const change = (currentPassword: string, newPassword: string, headers?: Record<string, string>) => request.post("/api/auth/change-password", { data: { currentPassword, newPassword }, headers });

  expect((await change(PW, "NovaSenha2031", { origin: "https://evil.example" })).status()).toBe(403); // CSRF
  const same = await change(PW, PW);
  expect(same.status()).toBe(400);
  expect((await same.json()).error).toBe("A nova senha precisa ser diferente da atual.");
  expect((await change(PW, "fraca")).status()).toBe(400);

  // Força bruta na senha atual: 5 erros em 15 minutos bloqueiam (por usuário, não por IP).
  for (let i = 0; i < 5; i++) expect((await change(`errada-${i}`, "NovaSenha2031", freshIp())).status()).toBe(400);
  const blocked = await change(PW, "NovaSenha2031", freshIp());
  expect(blocked.status()).toBe(429);
  // A senha não mudou.
  const fresh = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect(await tryLogin(fresh, users.guarda.email, PW)).toBe(200);
  await fresh.dispose();
});

test("esqueci minha senha → link → redefinir → login; sessões antigas caem e o link não vale de novo", async ({ page, browser }) => {
  const u = users.esqueci;
  const old = await browser.newContext();
  await apiLogin(old.request, { email: u.email, password: PW });

  // Pedido pela tela de login.
  await page.goto("/login");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page).toHaveURL(/\/login\/recuperar$/);
  await page.waitForTimeout(1500); // hidratação
  await page.getByLabel("E-mail").fill(u.email.toUpperCase()); // maiúsculas não atrapalham
  await page.getByRole("button", { name: "Enviar link de redefinição" }).click();
  await expect(page.getByRole("status")).toContainText("Pedido recebido");
  await expect(page.getByRole("status")).toContainText("Peça ao suporte o link de redefinição");

  // O token nasce depois da resposta (after): no banco fica só o hash, com validade de 30 minutos.
  const db = await prisma();
  await expect.poll(() => db.passwordReset.count({ where: { userId: ids.esqueci } }), { timeout: 10_000 }).toBe(1);
  const row = await db.passwordReset.findFirstOrThrow({ where: { userId: ids.esqueci } });
  expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  expect(row.usedAt).toBeNull();
  const ttlMin = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
  expect(ttlMin).toBeGreaterThan(29.9);
  expect(ttlMin).toBeLessThan(30.1);
  // O link só vai para o WhatsApp do estúdio (desconectado nos testes) ou para o log do servidor: o histórico de
  // mensagens não guarda o token.
  const leaked = await db.messageLog.count({ where: { body: { contains: "redefinir?token=" } } });
  expect(leaked).toBe(0);
  // A senha atual continua valendo até a nova ser definida.
  expect(await me(old.request)).not.toBeNull();

  // O token só existe no link (o banco tem o hash). Para seguir o fluxo, o teste troca o hash pelo de um token conhecido.
  const token = newToken();
  await db.passwordReset.update({ where: { id: row.id }, data: { tokenHash: sha256(token) } });

  // Link sem token: explica e oferece pedir outro.
  await page.goto("/login/redefinir");
  await expect(page.getByRole("heading", { name: "Link incompleto" })).toBeVisible();

  await page.goto(`/login/redefinir?token=${token}`);
  await page.waitForTimeout(1500); // hidratação
  const next = page.getByLabel("Nova senha", { exact: true });
  const confirm = page.getByLabel("Confirmar nova senha");
  const save = page.getByRole("button", { name: "Salvar nova senha" });
  await next.fill("12345678");
  await confirm.fill("12345678");
  await save.click();
  await expect(page.locator("form").getByRole("alert")).toContainText("pelo menos uma letra");
  await next.fill("Recuperada2031");
  await confirm.fill("Recuperada2032");
  await save.click();
  await expect(page.locator("form").getByRole("alert")).toContainText("A confirmação não confere");
  expect((await db.passwordReset.findUniqueOrThrow({ where: { id: row.id } })).usedAt).toBeNull(); // erros de formulário não gastam o link
  await confirm.fill("Recuperada2031");
  await save.click();

  // Volta ao login com aviso; entra com a senha nova.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Senha redefinida! Entre com a nova senha.")).toBeVisible();
  await page.getByLabel("E-mail").fill(u.email);
  await page.getByLabel("Senha").fill("Recuperada2031");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Sessões anteriores derrubadas, token marcado como usado e senha antiga inválida.
  expect(await me(old.request)).toBeNull();
  expect((await db.passwordReset.findUniqueOrThrow({ where: { id: row.id } })).usedAt).not.toBeNull();
  expect(await tryLogin(old.request, u.email, PW)).toBe(401);
  // Uso único: o mesmo link não troca a senha de novo.
  const reuse = await old.request.post("/api/auth/reset", { data: { token, password: "OutraSenha2031" }, headers: freshIp() });
  expect(reuse.status()).toBe(400);
  expect((await reuse.json()).error).toMatch(/Link inválido ou expirado/);
  expect(await tryLogin(old.request, u.email, "OutraSenha2031")).toBe(401);
  await db.$disconnect();
  await old.close();
});

test("token de redefinição: sem enumeração de e-mail, expira em 30 min, anteriores invalidados, uso único e Host forjado", async ({ request, playwright }) => {
  const db = await prisma();
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  const reset = (token: string, password = "Token2031abc") => anon.post("/api/auth/reset", { data: { token, password }, headers: freshIp() });

  // /forgot: e-mail que existe e e-mail que não existe respondem igual (204, sem corpo).
  const yes = await anon.post("/api/auth/forgot", { data: { email: users.token.email }, headers: freshIp() });
  const no = await anon.post("/api/auth/forgot", { data: { email: "ninguem@local.test" }, headers: freshIp() });
  expect([yes.status(), no.status()]).toEqual([204, 204]);
  expect([await yes.text(), await no.text()]).toEqual(["", ""]);
  const strip = (h: Record<string, string>) => Object.keys(h).filter((k) => !["date", "x-nextjs-cache", "etag"].includes(k)).sort();
  expect(strip(yes.headers())).toEqual(strip(no.headers()));
  await expect.poll(() => db.passwordReset.count({ where: { userId: ids.token } }), { timeout: 10_000 }).toBe(1);
  expect(await db.passwordReset.count()).toBe(await db.passwordReset.count({ where: { user: { email: { startsWith: "qa-" } } } })); // nada criado para e-mail inexistente
  expect((await anon.post("/api/auth/forgot", { data: { email: "sem-arroba" }, headers: freshIp() })).status()).toBe(400);

  // Um pedido novo apaga o anterior (fica só um token válido por usuário).
  const firstHash = (await db.passwordReset.findFirstOrThrow({ where: { userId: ids.token } })).tokenHash;
  await anon.post("/api/auth/forgot", { data: { email: users.token.email }, headers: freshIp() });
  await expect.poll(async () => (await db.passwordReset.findFirst({ where: { userId: ids.token } }))?.tokenHash, { timeout: 10_000 }).not.toBe(firstHash);
  expect(await db.passwordReset.count({ where: { userId: ids.token } })).toBe(1);

  // Link gerado pelo painel (devolve o link a quem está logada). Com APP_ORIGIN definido, Host/X-Forwarded-Host
  // forjados não mudam o endereço do link.
  await apiLogin(request);
  const issue = async (headers: Record<string, string> = {}) => {
    const r = await request.post(`/api/admin/users/${ids.token}/reset-link`, { data: {}, headers });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "link", "whatsappSent"]);
    return { ...body, token: new URL(body.link).searchParams.get("token")! } as { link: string; expiresAt: string; whatsappSent: boolean; token: string };
  };
  const l1 = await issue({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
  expect(l1.link.startsWith("http://localhost:3100/login/redefinir?token=")).toBe(true);
  expect(l1.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const stored = await db.passwordReset.findMany({ where: { userId: ids.token } });
  expect(stored).toHaveLength(1);
  expect(stored[0].tokenHash).toBe(sha256(l1.token)); // SHA-256 do token; o token em si não está no banco
  expect(Math.abs(new Date(l1.expiresAt).getTime() - (Date.now() + 30 * 60_000))).toBeLessThan(60_000);

  // Anteriores invalidados: com o segundo link, o primeiro deixa de valer.
  const l2 = await issue();
  expect(l2.token).not.toBe(l1.token);
  expect((await reset(l1.token)).status()).toBe(400);

  // Token errado, o hash no lugar do token e senha fraca: nada muda.
  expect((await reset(newToken())).status()).toBe(400);
  expect((await reset(sha256(l2.token))).status()).toBe(400);
  expect((await reset(l2.token, "fraca")).status()).toBe(400);
  expect((await db.passwordReset.findFirstOrThrow({ where: { userId: ids.token } })).usedAt).toBeNull();

  // Expiração: passados os 30 minutos o link não vale (o teste adianta o vencimento no banco).
  await db.passwordReset.updateMany({ where: { userId: ids.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await reset(l2.token);
  expect(expired.status()).toBe(400);
  expect((await expired.json()).error).toMatch(/Link inválido ou expirado/);
  const check = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect(await tryLogin(check, users.token.email, PW)).toBe(200); // senha original intacta

  // Link válido: troca a senha uma vez; a segunda tentativa falha; a sessão aberta acima cai.
  const l3 = await issue();
  expect((await reset(l3.token)).status()).toBe(204);
  expect((await reset(l3.token, "Segunda2031abc")).status()).toBe(400);
  expect(await me(check)).toBeNull();
  expect(await tryLogin(check, users.token.email, PW)).toBe(401);
  expect(await tryLogin(check, users.token.email, "Token2031abc")).toBe(200);
  expect(await db.passwordReset.count({ where: { userId: ids.token, usedAt: null } })).toBe(0);

  await check.dispose();
  await anon.dispose();
  await db.$disconnect();
});

test("rate limit por IP: /forgot e /reset aceitam 5 pedidos em 15 minutos e bloqueiam o 6º", async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  const ip = { "x-forwarded-for": "203.0.113.77" };
  for (let i = 0; i < 5; i++) expect((await anon.post("/api/auth/forgot", { data: { email: "ninguem@local.test" }, headers: ip })).status()).toBe(204);
  const forgot = await anon.post("/api/auth/forgot", { data: { email: "ninguem@local.test" }, headers: ip });
  expect(forgot.status()).toBe(429);
  expect((await forgot.json()).error).toMatch(/Muitas tentativas/);

  for (let i = 0; i < 5; i++) expect((await anon.post("/api/auth/reset", { data: { token: newToken(), password: "Qualquer2031" }, headers: ip })).status()).toBe(400);
  expect((await anon.post("/api/auth/reset", { data: { token: newToken(), password: "Qualquer2031" }, headers: ip })).status()).toBe(429);
  // Outro IP não é afetado.
  expect((await anon.post("/api/auth/forgot", { data: { email: "ninguem@local.test" }, headers: { "x-forwarded-for": "203.0.113.78" } })).status()).toBe(204);
  await anon.dispose();
});
