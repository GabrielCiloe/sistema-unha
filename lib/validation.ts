import { z } from "zod";

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  durationMin: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(100).max(10_000_00),
  active: z.boolean().default(true),
});

export const businessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  pixKey: z.string().trim().max(120),
  pixName: z.string().trim().max(60),
  pixCity: z.string().trim().max(30),
  depositPercent: z.number().int().min(10).max(100),
  openMinutes: z.number().int().min(0).max(1439),
  closeMinutes: z.number().int().min(1).max(1440),
  workDays: z.array(z.number().int().min(0).max(6)).max(7),
  slotStepMinutes: z.number().int().refine((n) => [10, 15, 20, 30, 45, 60].includes(n), "Intervalo inválido"),
  bufferMinutes: z.number().int().min(0).max(120),
  reminderHours: z.number().int().min(1).max(72),
  returnEnabled: z.boolean(),
  returnAfterDays: z.number().int().min(1).max(365),
  returnWindowStart: z.number().int().min(0).max(1439),
  returnWindowEnd: z.number().int().min(1).max(1440),
  returnTemplate: z.string().trim().max(1500),
  waSessionId: z.string().trim().max(80),
  confirmationTemplate: z.string().trim().min(5).max(600),
  reminderTemplate: z.string().trim().min(5).max(600),
})
  .refine((b) => b.closeMinutes > b.openMinutes, "Fechamento deve ser depois da abertura")
  .refine((b) => b.returnWindowEnd > b.returnWindowStart, "O horário final dos convites deve ser depois do inicial");

export const bookingSchema = z.object({
  serviceIds: z.array(z.string()).min(1).max(6),
  startsAt: z.string().datetime(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(20),
  notes: z.string().trim().max(300).optional(),
});

export const loginSchema = z.object({ email: z.string().trim().email().max(120), password: z.string().min(1).max(200) });

// Verifica assinatura (magic bytes) de PNG / JPEG / PDF.
export function sniffProof(buf: Buffer): "image/png" | "image/jpeg" | "application/pdf" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 5 && buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}
