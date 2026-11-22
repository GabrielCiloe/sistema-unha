import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Banco simulado em memória: só as operações que lib/server/password-reset usa. O comportamento com o Postgres
// de verdade (transação, índice único) é conferido no teste de fluxo (tests/e2e/senha.spec.ts).
type Reset = { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
const state = vi.hoisted(() => ({
  resets: [] as Reset[],
  users: new Map<string, { passwordHash: string }>(),
  sessions: [] as { id: string; userId: string }[],
  seq: 0,
  sent: [] as { phone: string; text: string; logBody?: string }[],
  whatsappOk: false,
  phone: "(11) 91234-5678",
}));

vi.mock("@/lib/server/db", () => {
  const db = {
    passwordReset: {
      async deleteMany({ where }: { where: { userId: string; id?: { not: string } } }) {
        const before = state.resets.length;
        state.resets = state.resets.filter((r) => !(r.userId === where.userId && (!where.id || r.id !== where.id.not)));
        return { count: before - state.resets.length };
      },
      async create({ data }: { data: Omit<Reset, "id" | "usedAt"> }) {
        const row = { id: `r${++state.seq}`, usedAt: null, ...data };
        state.resets.push(row);
        return row;
      },
      async updateMany({ where, data }: { where: { tokenHash: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } }) {
        const hit = state.resets.filter((r) => r.tokenHash === where.tokenHash && r.usedAt === where.usedAt && r.expiresAt > where.expiresAt.gt);
        for (const r of hit) r.usedAt = data.usedAt;
        return { count: hit.length };
      },
      async findUniqueOrThrow({ where }: { where: { tokenHash: string } }) {
        const r = state.resets.find((x) => x.tokenHash === where.tokenHash);
        if (!r) throw new Error("not found");
        return r;
      },
    },
    user: {
      async update({ where, data }: { where: { id: string }; data: { passwordHash: string } }) {
        state.users.set(where.id, data);
        return data;
      },
    },
    session: {
      async deleteMany({ where }: { where: { userId: string } }) {
        state.sessions = state.sessions.filter((s) => s.userId !== where.userId);
        return {};
      },
    },
    async $transaction(arg: unknown) {
      return typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as Promise<unknown>[]);
    },
  };
  return { db, getBusiness: async () => ({ name: "Estúdio Teste", phone: state.phone }) };
});

vi.mock("@/lib/server/whatsapp", () => ({
  sendText: async (phone: string, text: string, opts: { logBody?: string } = {}) => {
    state.sent.push({ phone, text, logBody: opts.logBody });
    return state.whatsappOk;
  },
}));

import { verifyPassword } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import { appOrigin, generatePassword, issuePasswordReset, RESET_TTL_MIN, RESET_TTL_MS, resetPasswordWithToken, sendResetLink } from "@/lib/server/password-reset";
import { passwordSchema } from "@/lib/validation";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const NOW = new Date("2030-03-10T12:00:00.000Z");

beforeEach(() => {
  state.resets = [];
  state.users = new Map([["u1", { passwordHash: "antigo" }], ["u2", { passwordHash: "antigo" }]]);
  state.sessions = [{ id: "s1", userId: "u1" }, { id: "s2", userId: "u1" }, { id: "s3", userId: "u2" }];
  state.sent = [];
  state.whatsappOk = false;
  state.phone = "(11) 91234-5678";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("issuePasswordReset (geração do token)", () => {
  it("o token tem 32 bytes aleatórios (base64url) e vai no link", async () => {
    const { link } = await issuePasswordReset("u1", "https://agenda.exemplo.com");
    expect(link.startsWith("https://agenda.exemplo.com/login/redefinir?token=")).toBe(true);
    const token = tokenOf(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("tokens nunca se repetem", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(tokenOf((await issuePasswordReset(`user${i}`, "http://x")).link));
    expect(seen.size).toBe(50);
  });

  it("o banco guarda só o SHA-256 do token, nunca o token", async () => {
    const token = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    expect(state.resets).toHaveLength(1);
    expect(state.resets[0].tokenHash).toBe(sha256(token));
    expect(state.resets[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(state.resets)).not.toContain(token);
  });

  it("expira em 30 minutos", async () => {
    expect(RESET_TTL_MS).toBe(30 * 60_000);
    expect(RESET_TTL_MIN).toBe(30);
    const { expiresAt } = await issuePasswordReset("u1", "http://x");
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    expect(state.resets[0].expiresAt).toEqual(expiresAt);
    expect(state.resets[0].usedAt).toBeNull();
  });

  it("um token novo invalida os anteriores do mesmo usuário (e só dele)", async () => {
    const first = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    const other = tokenOf((await issuePasswordReset("u2", "http://x")).link);
    const second = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    expect(state.resets.map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
    await expect(resetPasswordWithToken(first, "NovaSenha1")).rejects.toMatchObject({ status: 400 });
    await expect(resetPasswordWithToken(other, "NovaSenha1")).resolves.toBeUndefined();
    await expect(resetPasswordWithToken(second, "NovaSenha1")).resolves.toBeUndefined();
  });
});

describe("resetPasswordWithToken", () => {
  it("troca a senha (hash scrypt), marca o token como usado e derruba todas as sessões do usuário", async () => {
    const token = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    await resetPasswordWithToken(token, "NovaSenha1");
    const stored = state.users.get("u1")!.passwordHash;
    expect(stored).not.toContain("NovaSenha1");
    expect(verifyPassword("NovaSenha1", stored)).toBe(true);
    expect(verifyPassword("outra", stored)).toBe(false);
    expect(state.resets[0].usedAt).toEqual(NOW);
    expect(state.sessions).toEqual([{ id: "s3", userId: "u2" }]);
    expect(state.users.get("u2")!.passwordHash).toBe("antigo");
  });

  it("uso único: o mesmo token não vale duas vezes", async () => {
    const token = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    await resetPasswordWithToken(token, "NovaSenha1");
    await expect(resetPasswordWithToken(token, "OutraSenha2")).rejects.toMatchObject({ status: 400 });
    expect(verifyPassword("NovaSenha1", state.users.get("u1")!.passwordHash)).toBe(true);
  });

  it("vale até 30 minutos e expira depois", async () => {
    const ok = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    vi.setSystemTime(NOW.getTime() + 30 * 60_000 - 1000);
    await expect(resetPasswordWithToken(ok, "NovaSenha1")).resolves.toBeUndefined();

    const late = tokenOf((await issuePasswordReset("u2", "http://x")).link);
    vi.setSystemTime(Date.now() + 30 * 60_000);
    await expect(resetPasswordWithToken(late, "NovaSenha1")).rejects.toMatchObject({ status: 400 });
    expect(state.users.get("u2")!.passwordHash).toBe("antigo");
    expect(state.sessions).toContainEqual({ id: "s3", userId: "u2" });
  });

  it("token inexistente, usado e expirado dão o mesmo erro (sem pistas)", async () => {
    const used = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    await resetPasswordWithToken(used, "NovaSenha1");
    const expired = tokenOf((await issuePasswordReset("u2", "http://x")).link);
    vi.setSystemTime(NOW.getTime() + 31 * 60_000);
    const messages = new Set<string>();
    for (const t of ["x".repeat(43), used, expired]) {
      const e = await resetPasswordWithToken(t, "NovaSenha1").catch((x) => x);
      expect(e).toBeInstanceOf(HttpError);
      expect(e.status).toBe(400);
      messages.add(e.message);
    }
    expect(messages.size).toBe(1);
  });

  it("o hash guardado não serve como token", async () => {
    await issuePasswordReset("u1", "http://x");
    await expect(resetPasswordWithToken(state.resets[0].tokenHash, "NovaSenha1")).rejects.toMatchObject({ status: 400 });
  });
});

describe("appOrigin (base do link)", () => {
  const req = (headers: Record<string, string>) => new Request("http://interno:3000/api/auth/forgot", { method: "POST", headers });

  it("com APP_ORIGIN definido, ignora Host e X-Forwarded-Host (cabeçalhos de quem faz a requisição)", () => {
    vi.stubEnv("APP_ORIGIN", "https://agenda.exemplo.com/");
    expect(appOrigin(req({ host: "malicioso.example", "x-forwarded-host": "malicioso.example", "x-forwarded-proto": "http" }))).toBe("https://agenda.exemplo.com");
  });

  it("sem APP_ORIGIN (dev/rede local), usa o host da requisição", () => {
    vi.stubEnv("APP_ORIGIN", "");
    expect(appOrigin(req({ "x-forwarded-host": "192.168.0.10:3000", "x-forwarded-proto": "http" }))).toBe("http://192.168.0.10:3000");
  });
});

describe("sendResetLink (provedores)", () => {
  const msg = { email: "ana@local.test", name: "Ana", link: "https://agenda.exemplo.com/login/redefinir?token=SEGREDO" };

  it("WhatsApp conectado: manda o link ao telefone do estúdio e o histórico não guarda o link", async () => {
    state.whatsappOk = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendResetLink(msg)).toBe("whatsapp");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].phone).toBe("(11) 91234-5678");
    expect(state.sent[0].text).toContain(msg.link);
    expect(state.sent[0].text).toContain("30 minutos");
    expect(state.sent[0].logBody).toBeTruthy();
    expect(state.sent[0].logBody).not.toContain("SEGREDO");
    expect(warn).not.toHaveBeenCalled();
  });

  it("WhatsApp desconectado: cai para o log do servidor (warn)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendResetLink(msg)).toBe("console");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(msg.link);
  });

  it("sem telefone do estúdio nem tenta o WhatsApp", async () => {
    state.phone = "";
    state.whatsappOk = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendResetLink(msg)).toBe("console");
    expect(state.sent).toHaveLength(0);
  });

  it("só WhatsApp (painel): desconectado devolve null e nada vai para o log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendResetLink(msg, ["whatsapp"])).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("generatePassword (senha inicial)", () => {
  it("atende à política, tem 14 caracteres e não usa caracteres ambíguos", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(14);
      expect(passwordSchema.safeParse(p).success).toBe(true);
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
