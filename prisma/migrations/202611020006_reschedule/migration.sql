-- Mensagem enviada à cliente quando o estúdio remarca o horário (Configurações > Mensagens).
ALTER TABLE "Business" ADD COLUMN "rescheduleTemplate" TEXT NOT NULL DEFAULT '';
