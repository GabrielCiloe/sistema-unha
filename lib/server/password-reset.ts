// Redefinição de senha por token: o token (32 bytes aleatórios) só existe no link; o banco guarda o SHA-256.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { passwordSchema } from "@/lib/validation";
import { hashPassword } from "./auth";
import { db, getBusiness } from "./db";
import { HttpError, rateLimit } from "./http";
import { sendText } from "./whatsapp";

export const RESET_TTL_MS = 30 * 60_000;
export const RESET_TTL_MIN = RESET_TTL_MS / 60_000;

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

// Base do link: APP_ORIGIN (a mesma origem validada no CSRF). Sem ela, usa o host da requisição.
// Só para rotas autenticadas ou fora de produção: o cabeçalho Host é controlado por quem faz a requisição.
export function appOrigin(req: Request) {
  const fixed = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

// Base do link nas rotas PÚBLICAS ("esqueci minha senha"): em produção só vale APP_ORIGIN. Sem ela devolve null
// (nenhum link é gerado): um Host forjado faria o link enviado ao estúdio apontar para o site de outra pessoa.
export function publicAppOrigin(req: Request) {
  if (process.env.NODE_ENV === "production" && !(process.env.APP_ORIGIN ?? "").trim()) return null;
  return appOrigin(req);
}

const serializationFailure = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";

// Cria um token novo e invalida (apaga) todos os anteriores do mesmo usuário.
// Serializable: dois pedidos simultâneos para o mesmo usuário não deixam dois tokens válidos. Quem perde a corrida
// (P2034) espera um instante e refaz, até ISSUE_ATTEMPTS vezes.
const ISSUE_ATTEMPTS = 5;
export async function issuePasswordReset(userId: string, origin: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  for (let attempt = 1; ; attempt++) {
    try {
      await db.$transaction(
        [db.passwordReset.deleteMany({ where: { userId } }), db.passwordReset.create({ data: { userId, tokenHash: sha(token), expiresAt } })],
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (e) {
      if (!serializationFailure(e) || attempt >= ISSUE_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, attempt * (20 + Math.random() * 40)));
    }
  }
  // Faxina: tokens vencidos de qualquer usuário (fora da transação; se falhar, não atrapalha a emissão).
  await db.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  return { link: `${origin}/login/redefinir?token=${token}`, expiresAt };
}

export const FORGOT_PER_EMAIL = 3; // pedidos atendidos por e-mail a cada 15 min
export const FORGOT_COOLDOWN_MS = 2 * 60_000; // um link recém-criado não é trocado por outro pedido

// "Esqueci minha senha", depois da resposta 204 (a rota chama dentro de after()): nada aqui é visível a quem pediu.
// O limite por e-mail conta igual para e-mail com ou sem acesso. `origin` null = APP_ORIGIN faltando em produção.
export async function requestPasswordReset(email: string, origin: string | null) {
  if (!origin) {
    console.error("[senha] APP_ORIGIN não está definida: o link de redefinição não foi gerado. Defina APP_ORIGIN com o endereço público do app (ex.: https://agenda.seudominio.com).");
    return;
  }
  try {
    rateLimit(`forgot-email:${email}`, FORGOT_PER_EMAIL, 15 * 60_000);
  } catch {
    return;
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  // Já existe um link novo (pedido repetido, ou gerado pelo painel): mantém, para um terceiro não invalidar o que acabou de chegar.
  const recent = await db.passwordReset.findFirst({ where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(Date.now() - FORGOT_COOLDOWN_MS) } }, select: { id: true } });
  if (recent) return;
  const { link } = await issuePasswordReset(user.id, origin);
  await sendResetLink({ email: user.email, name: user.name, link });
}

const INVALID = "Link inválido ou expirado. Peça um novo link de redefinição.";

// Troca a senha com o token: uso único, não expirado. Derruba todas as sessões do usuário.
// A mesma mensagem para token inexistente, usado ou expirado (não dá pistas a quem tenta adivinhar).
export async function resetPasswordWithToken(token: string, password: string) {
  const tokenHash = sha(token);
  // Confere o token antes do scrypt: pedidos com token inválido não gastam o cálculo caro do hash da senha.
  const candidate = await db.passwordReset.findUnique({ where: { tokenHash }, select: { usedAt: true, expiresAt: true } });
  if (!candidate || candidate.usedAt || candidate.expiresAt <= new Date()) throw new HttpError(400, INVALID);
  const passwordHash = hashPassword(password);
  await db.$transaction(async (tx) => {
    // Marca como usado de forma atômica: duas requisições com o mesmo token não passam juntas.
    const used = await tx.passwordReset.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new HttpError(400, INVALID);
    const reset = await tx.passwordReset.findUniqueOrThrow({ where: { tokenHash } });
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: reset.userId } });
    await tx.passwordReset.deleteMany({ where: { userId: reset.userId, id: { not: reset.id } } });
  });
}

// --- Envio do link -------------------------------------------------------------------------------------------
// Provedores plugáveis: para enviar por e-mail depois, acrescente "email" aqui e em `providers`.
export type ResetProvider = "whatsapp" | "console";
type ResetMessage = { email: string; name: string; link: string };

const providers: Record<ResetProvider, (m: ResetMessage) => Promise<boolean>> = {
  // WhatsApp do próprio estúdio (Business.phone), pela conexão já existente. O histórico de mensagens não guarda o link.
  async whatsapp(m) {
    const biz = await getBusiness();
    if (biz.phone.replace(/\D/g, "").length < 10) return false;
    const text = [
      `🔐 Redefinição de senha do painel — ${biz.name}`,
      `Acesso: ${m.email}`,
      `Abra o link para criar uma nova senha (vale ${RESET_TTL_MIN} minutos e só pode ser usado uma vez):`,
      m.link,
      "Se não foi você quem pediu, ignore esta mensagem.",
    ].join("\n");
    return sendText(biz.phone, text, { logBody: `🔐 Link de redefinição de senha do painel (${m.email}). O link não fica guardado no histórico.` });
  },
  // Reserva: o link sai no log do servidor (nível warn) para o suporte repassar. Único lugar em que o token é logado.
  async console(m) {
    console.warn(`[senha] Link de redefinição para ${m.email} (vale ${RESET_TTL_MIN} min, uso único): ${m.link}`);
    return true;
  },
};

// Tenta os provedores na ordem e devolve o que entregou (ou null se nenhum).
export async function sendResetLink(m: ResetMessage, order: ResetProvider[] = ["whatsapp", "console"]): Promise<ResetProvider | null> {
  for (const p of order) {
    try {
      if (await providers[p](m)) return p;
    } catch {
      // segue para o próximo provedor
    }
  }
  return null;
}

// --- Senha inicial -------------------------------------------------------------------------------------------
// Sem caracteres ambíguos (0/O, 1/l/I): a senha é lida na tela e digitada uma vez.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generatePassword(length = 14) {
  for (;;) {
    const p = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (passwordSchema.safeParse(p).success) return p;
  }
}
