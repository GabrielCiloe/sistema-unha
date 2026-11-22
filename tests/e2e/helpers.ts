// Apoio dos testes de fluxo do agendamento interno e da gestão de senha/usuários.
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@local.test", password: "dev-password-12345" };
export const TZ = "America/Sao_Paulo";

// SEGURANÇA: estes testes apagam e alteram dados. Só rodam num banco local cujo nome termina em _test.
export function assertTestDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127.0.0.1)[:/][^?]*_test/.test(url)) throw new Error("Testes e2e só rodam num banco local cujo nome termina em _test (npm run test:db:setup).");
}

export async function prisma() {
  assertTestDb();
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient();
}

export const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
// Mesmo formato de lib/server/auth.ts (scrypt, sal:hash em hex).
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export async function login(page: Page, who = ADMIN) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar" }).waitFor();
  await page.waitForTimeout(1500); // hidratação
  await page.getByLabel("E-mail").fill(who.email);
  await page.getByLabel("Senha").fill(who.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export async function apiLogin(request: APIRequestContext, who = ADMIN) {
  const r = await request.post("/api/auth/login", { data: who });
  expect(r.status()).toBe(200);
}

// Os limites de tentativas são por IP e ficam na memória do servidor, que é o mesmo para todos os testes.
// Cada cenário usa um IP próprio (X-Forwarded-For) para não esbarrar no limite dos outros.
let ipSeq = 0;
const ipBlock = 1 + Math.floor(Math.random() * 250);
export const freshIp = () => ({ "x-forwarded-for": `10.${ipBlock}.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` });

export const todayLocal = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
export const hhmm = (iso: string | Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// Horário local (UTC-3) -> ISO em UTC.
export const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
