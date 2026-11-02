-- Marca que o aviso "recebemos seu comprovante" ja foi enviado para a reserva (um por reserva).
ALTER TABLE "Appointment" ADD COLUMN "proofAckSentAt" TIMESTAMP(3);
