import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (req: Request, ctx: any) => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) return json({ error: "Dados inválidos.", issues: e.issues.map((i) => i.message) }, 400);
      console.error(e);
      return json({ error: "Erro interno." }, 500);
    }
  };
}

// CSRF: requisições que alteram estado precisam vir da própria origem.
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // chamadas servidor-a-servidor (webhooks) não têm Origin
  const allowed = process.env.APP_ORIGIN;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const ok = allowed ? origin === allowed : host ? new URL(origin).host === host : false;
  if (!ok) throw new HttpError(403, "Origem não permitida.");
}

// Limite simples por chave em memória (por instância; protege contra força bruta básica).
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++h.n > max) throw new HttpError(429, "Muitas tentativas. Aguarde um instante.");
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

// Limitador só de FALHAS (ex.: senha errada): consulta antes, registra a falha, zera no sucesso.
const fails = new Map<string, { n: number; reset: number }>();
export const failureGuard = {
  check(key: string, max: number) {
    const f = fails.get(key);
    if (f && f.reset > Date.now() && f.n >= max) throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos.");
  },
  fail(key: string, windowMs: number) {
    const now = Date.now();
    const f = fails.get(key);
    if (!f || f.reset < now) fails.set(key, { n: 1, reset: now + windowMs });
    else f.n++;
  },
  ok(key: string) {
    fails.delete(key);
  },
};
