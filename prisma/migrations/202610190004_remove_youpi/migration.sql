-- Remove o gateway YouPI: so existe Pix manual (QR/copia e cola + comprovante).
-- Cobrancas YouPI ainda nao pagas ficam sem como pagar: cancela a reserva e apaga a cobranca.
UPDATE "Appointment" SET "status" = 'CANCELLED'
  WHERE "status" = 'PENDING_PAYMENT'
    AND "id" IN (SELECT "appointmentId" FROM "Payment" WHERE "provider" = 'YOUPI' AND "status" <> 'PAID');
DELETE FROM "Payment" WHERE "provider" = 'YOUPI' AND "status" <> 'PAID';

DROP INDEX IF EXISTS "Payment_externalId_key";
ALTER TABLE "Payment" DROP COLUMN "provider", DROP COLUMN "externalId", DROP COLUMN "checkoutUrl";
ALTER TABLE "Business" DROP COLUMN "paymentProvider";
DROP TYPE "PaymentProvider";
