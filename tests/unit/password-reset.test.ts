import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Banco simulado em memória: só as operações que lib/server/password-reset usa. O comportamento com o Postgres
// de verdade (transação, índice único) é conferido no teste de fluxo (tests/e2e/senha.spec.ts).
type Reset = { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null; createdAt: Date };
const state = vi.hoisted(() => ({
  resets: [] as Reset[],
  users: new Map<string, { passwordHash: string; email?: string; name?: string }>(),
  txOptions: [] as unknown[],
  failTx: 0, // quantas próximas transações falham com P2034 (conflito de serialização)
  sessions: [] as { id: string; userId: string }[],
  seq: 0,
  sent: [] as { phone: string; text: string; logBody?: string }[],
  whatsappOk: false,
  phone: "(11) 91234-5678",
}));

vi.mock("@/lib/server/db", () => {
  const db = {
    passwordReset: {
      async deleteMany({ where }: { where: { userId?: string; id?: { not: string }; expiresAt?: { lt: Date } } }) {
        const before = state.resets.length;
        const hit = (r: Reset) => (!where.userId || r.userId === where.userId) && (!where.id || r.id !== where.id.not) && (!where.expiresAt || r.expiresAt < where.expiresAt.lt);
        state.resets = state.resets.filter((r) => !hit(r));
        return { count: before - state.resets.length };
      },
      async create({ data }: { data: Omit<Reset, "id" | "usedAt" | "createdAt"> }) {
        const row = { id: `r${++state.seq}`, usedAt: null, createdAt: new Date(), ...data };
        state.resets.push(row);
        return row;
      },
      async findUnique({ where }: { where: { tokenHash: string } }) {
        return state.resets.find((x) => x.tokenHash === where.tokenHash) ?? null;
      },
      async findFirst({ where }: { where: { userId: string; usedAt: null; createdAt: { gt: Date } } }) {
        return state.resets.find((r) => r.userId === where.userId && r.usedAt === null && r.createdAt > where.createdAt.gt) ?? null;
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
        state.users.set(where.id, { ...state.users.get(where.id), ...data });
        return data;
      },
      async findUnique({ where }: { where: { email: string } }) {
        for (const [id, u] of state.users) if (u.email === where.email) return { id, email: u.email, name: u.name ?? "" };
        return null;
      },
    },
    session: {
      async deleteMany({ where }: { where: { userId: string } }) {
        state.sessions = state.sessions.filter((s) => s.userId !== where.userId);
        return {};
      },
    },
    async $transaction(arg: unknown, options?: unknown) {
      state.txOptions.push(options);
      if (state.failTx > 0) {
        state.failTx--;
        const { Prisma } = await import("@prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("conflito de serialização", { code: "P2034", clientVersion: "teste" });
      }
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

// hashPassword de verdade, mas observável: o scrypt só pode rodar depois de o token ser conferido.
vi.mock("@/lib/server/auth", async (original) => {
  const real = await original<typeof import("@/lib/server/auth")>();
  return { ...real, hashPassword: vi.fn(real.hashPassword) };
});

import { hashPassword, verifyPassword } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import {
  appOrigin,
  FORGOT_COOLDOWN_MS,
  FORGOT_PER_EMAIL,
  generatePassword,
  issuePasswordReset,
  publicAppOrigin,
  requestPasswordReset,
  RESET_TTL_MIN,
  RESET_TTL_MS,
  resetPasswordWithToken,
  sendResetLink,
} from "@/lib/server/password-reset";
import { passwordSchema } from "@/lib/validation";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const NOW = new Date("2030-03-10T12:00:00.000Z");

beforeEach(() => {
  state.resets = [];
  state.users = new Map([["u1", { passwordHash: "antigo", email: "u1@local.test", name: "Um" }], ["u2", { passwordHash: "antigo", email: "u2@local.test", name: "Dois" }]]);
  state.txOptions = [];
  state.failTx = 0;
  vi.mocked(hashPassword).mockClear();
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

  it("apagar os anteriores e criar o novo roda em transação Serializable (sem dois tokens válidos em corrida)", async () => {
    await issuePasswordReset("u1", "http://x");
    expect(state.txOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("conflito de serialização (P2034): refaz e termina com um único token, o do link devolvido", async () => {
    state.failTx = 2;
    const { link } = await issuePasswordReset("u1", "http://x");
    expect(state.txOptions).toHaveLength(3);
    expect(state.resets).toHaveLength(1);
    expect(state.resets[0].tokenHash).toBe(sha256(tokenOf(link)));
  });

  it("conflito que persiste: desiste depois de 5 tentativas e propaga o erro", async () => {
    state.failTx = 9;
    await expect(issuePasswordReset("u1", "http://x")).rejects.toMatchObject({ code: "P2034" });
    expect(state.txOptions).toHaveLength(5);
  });

  it("ao emitir, apaga os tokens vencidos de qualquer usuário e mantém os válidos", async () => {
    await issuePasswordReset("u2", "http://x");
    vi.setSystemTime(NOW.getTime() + 20 * 60_000);
    await issuePasswordReset("u3", "http://x"); // u2 ainda vale (20 min)
    expect(state.resets.map((r) => r.userId).sort()).toEqual(["u2", "u3"]);
    vi.setSystemTime(NOW.getTime() + 31 * 60_000);
    await issuePasswordReset("u1", "http://x"); // u2 venceu; u3 ainda vale
    expect(state.resets.map((r) => r.userId).sort()).toEqual(["u1", "u3"]);
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

  it("token inválido, usado ou expirado é recusado antes de calcular o hash da senha (scrypt)", async () => {
    const used = tokenOf((await issuePasswordReset("u1", "http://x")).link);
    await resetPasswordWithToken(used, "NovaSenha1");
    expect(hashPassword).toHaveBeenCalledTimes(1);
    const expired = tokenOf((await issuePasswordReset("u2", "http://x")).link);
    vi.setSystemTime(NOW.getTime() + 31 * 60_000);
    vi.mocked(hashPassword).mockClear();
    for (const t of ["x".repeat(43), used, expired]) await expect(resetPasswordWithToken(t, "NovaSenha1")).rejects.toMatchObject({ status: 400 });
    expect(hashPassword).not.toHaveBeenCalled();
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

  it("rota pública em produção sem APP_ORIGIN: não há base de link (nunca o Host da requisição)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    expect(publicAppOrigin(req({ host: "malicioso.example", "x-forwarded-host": "malicioso.example", "x-forwarded-proto": "https" }))).toBeNull();
    vi.stubEnv("APP_ORIGIN", "   ");
    expect(publicAppOrigin(req({ host: "malicioso.example" }))).toBeNull();
  });

  it("rota pública em produção com APP_ORIGIN: usa APP_ORIGIN e ignora o Host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://agenda.exemplo.com");
    expect(publicAppOrigin(req({ host: "malicioso.example", "x-forwarded-host": "malicioso.example" }))).toBe("https://agenda.exemplo.com");
  });

  it("rota pública fora de produção sem APP_ORIGIN: o host da requisição continua valendo (dev/rede local)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "");
    expect(publicAppOrigin(req({ "x-forwarded-host": "192.168.0.10:3000", "x-forwarded-proto": "http" }))).toBe("http://192.168.0.10:3000");
  });
});

describe("requestPasswordReset (esqueci minha senha, depois da resposta 204)", () => {
  // O limite por e-mail fica em memória (rateLimit): cada teste usa um e-mail só dele.
  const addUser = (id: string, email: string) => state.users.set(id, { passwordHash: "antigo", email, name: id });
  const silence = () => ({ warn: vi.spyOn(console, "warn").mockImplementation(() => {}), error: vi.spyOn(console, "error").mockImplementation(() => {}) });

  it("e-mail com acesso: cria o token e manda o link (aqui, para o log)", async () => {
    const { warn } = silence();
    addUser("a1", "pede@local.test");
    await requestPasswordReset("pede@local.test", "https://agenda.exemplo.com");
    expect(state.resets.map((r) => r.userId)).toEqual(["a1"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("https://agenda.exemplo.com/login/redefinir?token=");
  });

  it("e-mail sem acesso: não cria nem envia nada", async () => {
    const { warn, error } = silence();
    await requestPasswordReset("ninguem@local.test", "https://agenda.exemplo.com");
    expect(state.resets).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("sem base de link (produção sem APP_ORIGIN): não gera token, não envia e registra erro de configuração", async () => {
    const { warn, error } = silence();
    addUser("a2", "semorigem@local.test");
    await requestPasswordReset("semorigem@local.test", null);
    await requestPasswordReset("ninguem2@local.test", null); // mesmo aviso para e-mail sem acesso
    expect(state.resets).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0][0])).toContain("APP_ORIGIN");
    expect(String(error.mock.calls[0][0])).not.toContain("semorigem@local.test");
  });

  it("pedido repetido em menos de 2 minutos não troca o link que acabou de ser criado", async () => {
    const { warn } = silence();
    addUser("a3", "repete@local.test");
    await requestPasswordReset("repete@local.test", "http://x");
    const first = state.resets[0].tokenHash;
    vi.setSystemTime(NOW.getTime() + FORGOT_COOLDOWN_MS - 1000);
    await requestPasswordReset("repete@local.test", "http://x");
    expect(state.resets.map((r) => r.tokenHash)).toEqual([first]);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + FORGOT_COOLDOWN_MS + 1000);
    await requestPasswordReset("repete@local.test", "http://x");
    expect(state.resets).toHaveLength(1);
    expect(state.resets[0].tokenHash).not.toBe(first);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("link recém-gerado pelo painel também não é invalidado por um pedido público", async () => {
    silence();
    addUser("a4", "painel@local.test");
    const { link } = await issuePasswordReset("a4", "http://x");
    await requestPasswordReset("painel@local.test", "http://x");
    expect(state.resets.map((r) => r.tokenHash)).toEqual([sha256(tokenOf(link))]);
  });

  it("no máximo 3 pedidos atendidos por e-mail a cada 15 minutos; depois a janela reabre", async () => {
    const { warn } = silence();
    addUser("a5", "limite@local.test");
    expect(FORGOT_PER_EMAIL).toBe(3);
    const step = FORGOT_COOLDOWN_MS + 1000; // fora da espera de 2 min, para cada pedido poder emitir
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(NOW.getTime() + i * step);
      await requestPasswordReset("limite@local.test", "http://x");
    }
    expect(warn).toHaveBeenCalledTimes(3);
    vi.setSystemTime(NOW.getTime() + 15 * 60_000 + 1000);
    await requestPasswordReset("limite@local.test", "http://x");
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("o limite por e-mail conta igual para e-mail sem acesso (nenhuma consulta ao banco depois do 3º)", async () => {
    silence();
    const { db } = await import("@/lib/server/db");
    const find = vi.spyOn(db.user, "findUnique");
    for (let i = 0; i < 5; i++) await requestPasswordReset("fantasma@local.test", "http://x");
    expect(find).toHaveBeenCalledTimes(3);
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
