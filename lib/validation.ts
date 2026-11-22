import { z } from "zod";
import { SLOT_STEP_OPTIONS } from "./defaults";

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  durationMin: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(100).max(10_000_00),
  missingNailPriceCents: z.number().int().min(0).max(100_000).default(0),
  active: z.boolean().default(true),
});

export const businessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  pixKey: z.string().trim().max(120),
  pixName: z.string().trim().max(60),
  pixCity: z.string().trim().max(30),
  depositPercent: z.number().int().min(10).max(100),
  openMinutes: z.number().int().min(0).max(1439),
  closeMinutes: z.number().int().min(1).max(1440),
  workDays: z.array(z.number().int().min(0).max(6)).max(7),
  schedule: z
    .partialRecord(
      z.enum(["0", "1", "2", "3", "4", "5", "6"]),
      z
        .object({
          on: z.boolean(),
          open: z.number().int().min(0).max(1439),
          lunchStart: z.number().int().min(0).max(1440).nullable(),
          lunchEnd: z.number().int().min(0).max(1440).nullable(),
          close: z.number().int().min(1).max(1440),
        })
        .refine((d) => !d.on || d.close > d.open, "Fechamento deve ser depois da abertura"),
    )
    .optional(),
  mapsAddress: z.string().trim().max(200).optional(),
  slotStepMinutes: z.number().int().refine((n) => (SLOT_STEP_OPTIONS as readonly number[]).includes(n), "Intervalo inválido"),
  bufferMinutes: z.number().int().min(0).max(120),
  minLeadDays: z.number().int().min(0).max(60),
  reminderHours: z.number().int().min(1).max(72),
  returnEnabled: z.boolean(),
  returnAfterDays: z.number().int().min(1).max(365),
  returnWindowStart: z.number().int().min(0).max(1439),
  returnWindowEnd: z.number().int().min(1).max(1440),
  returnTemplate: z.string().trim().max(1500),
  waSessionId: z.string().trim().max(80),
  confirmationTemplate: z.string().trim().min(5).max(600),
  reminderTemplate: z.string().trim().min(5).max(1500),
  rescheduleTemplate: z.string().trim().max(600),
})
  .refine((b) => b.closeMinutes > b.openMinutes, "Fechamento deve ser depois da abertura")
  .refine((b) => b.returnWindowEnd > b.returnWindowStart, "O horário final dos convites deve ser depois do inicial");

export const MAX_MISSING_NAILS = 10;

export const bookingSchema = z.object({
  serviceIds: z.array(z.string()).min(1).max(6),
  // Unhas faltando por servico de manutencao (so vale para servicos com preco por unha).
  missingNails: z.record(z.string(), z.number().int().min(0).max(MAX_MISSING_NAILS)).optional(),
  startsAt: z.string().datetime(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(20),
  notes: z.string().trim().max(300).optional(),
});

// Agendamento interno (painel): mesma reserva da cliente, com as liberdades da dona.
export const adminBookingSchema = bookingSchema.extend({
  // Permite agendar para hoje, ignorando a antecedência mínima em dias. Padrão do painel: true.
  allowToday: z.boolean().default(true),
  // "Horário fora da grade": hora local (HH:MM) no dia de `startsAt`; substitui a hora de `startsAt`.
  manualTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).").optional(),
  // Sinal recebido em mãos: já confirma o pagamento e o agendamento.
  markDepositPaid: z.boolean().optional(),
  // Já envia à cliente, pelo WhatsApp, a reserva com o Pix copia e cola (mesmo efeito de /send-pix).
  sendPix: z.boolean().optional(),
});

export const loginSchema = z.object({ email: z.string().trim().email().max(120), password: z.string().min(1).max(200) });

// Política de senha do painel (única para todo o sistema): troca, redefinição e senha inicial gerada.
export const PASSWORD_MIN = 8;
export const PASSWORD_HINT = `Mínimo de ${PASSWORD_MIN} caracteres, com pelo menos uma letra e um número.`;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`)
  .max(200, "A senha é longa demais.")
  .regex(/\p{L}/u, "A senha precisa ter pelo menos uma letra.")
  .regex(/\d/, "A senha precisa ter pelo menos um número.");

// Primeiro problema da senha (ou null se atende à política). Usado nos formulários antes de enviar.
export const passwordProblem = (password: string) => passwordSchema.safeParse(password).error?.issues[0]?.message ?? null;

const emailField = z.string().trim().toLowerCase().email("E-mail inválido.").max(120);

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });
export const forgotPasswordSchema = z.object({ email: emailField });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

// Usuários do painel. A senha inicial é gerada pelo servidor (nunca vem do formulário).
export const userCreateSchema = z.object({ name: z.string().trim().min(2, "Informe o nome.").max(80), email: emailField });
export const userUpdateSchema = userCreateSchema.partial().refine((u) => u.name !== undefined || u.email !== undefined, "Nada para alterar.");
export const resetLinkSchema = z.object({ send: z.boolean().optional() });

// Verifica assinatura (magic bytes) de PNG / JPEG / PDF.
export function sniffProof(buf: Buffer): "image/png" | "image/jpeg" | "application/pdf" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 5 && buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}
