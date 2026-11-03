-- Prazo do sinal por reserva: 30 min ao agendar, renovado a cada recusa de comprovante.
ALTER TABLE "Appointment" ADD COLUMN "holdUntil" TIMESTAMP(3);
UPDATE "Appointment" SET "holdUntil" = "createdAt" + interval '30 minutes';
ALTER TABLE "Appointment" ALTER COLUMN "holdUntil" SET NOT NULL;
CREATE INDEX "Appointment_status_holdUntil_idx" ON "Appointment"("status", "holdUntil");
