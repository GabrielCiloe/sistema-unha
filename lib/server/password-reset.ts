// Redefinição de senha por token: o token (32 bytes aleatórios) só existe no link; o banco guarda o SHA-256.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { passwordSchema } from "@/lib/validation";
import { hashPassword } from "./auth";
import { db, getBusiness } from "./db";
import { HttpError } from "./http";
import { sendText } from "./whatsapp";

export const RESET_TTL_MS = 30 * 60_000;
export const RESET_TTL_MIN = RESET_TTL_MS / 60_000;

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

// Base do link: APP_ORIGIN (a mesma origem validada no CSRF). Sem ela (dev/rede local), usa o host da requisição.
// Em produção defina APP_ORIGIN: o cabeçalho Host é controlado por quem faz a requisição.
export function appOrigin(req: Request) {
  const fixed = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

// Cria um token novo e invalida (apaga) todos os anteriores do mesmo usuário.
export async function issuePasswordReset(userId: string, origin: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.$transaction([
    db.passwordReset.deleteMany({ where: { userId } }),
    db.passwordReset.create({ data: { userId, tokenHash: sha(token), expiresAt } }),
  ]);
  return { link: `${origin}/login/redefinir?token=${token}`, expiresAt };
}

const INVALID = "Link inválido ou expirado. Peça um novo link de redefinição.";

// Troca a senha com o token: uso único, não expirado. Derruba todas as sessões do usuário.
// A mesma mensagem para token inexistente, usado ou expirado (não dá pistas a quem tenta adivinhar).
export async function resetPasswordWithToken(token: string, password: string) {
  const tokenHash = sha(token);
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
