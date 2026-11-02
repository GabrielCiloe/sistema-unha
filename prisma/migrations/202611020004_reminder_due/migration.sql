-- Horario sorteado do lembrete (envio espalhado e aleatorio).
ALTER TABLE "Appointment" ADD COLUMN "reminderDueAt" TIMESTAMP(3);
CREATE INDEX "Appointment_reminderDueAt_idx" ON "Appointment"("reminderDueAt");
