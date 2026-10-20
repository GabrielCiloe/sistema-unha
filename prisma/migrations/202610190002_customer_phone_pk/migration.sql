-- O numero do WhatsApp (phone) passa a ser a chave primaria de Customer.
-- Os vinculos (customerId) de Appointment e MessageLog passam a guardar o telefone; dados existentes sao convertidos.

ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_customerId_fkey";
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_customerId_fkey";

UPDATE "Appointment" a SET "customerId" = c."phone" FROM "Customer" c WHERE a."customerId" = c."id";
UPDATE "MessageLog" m SET "customerId" = c."phone" FROM "Customer" c WHERE m."customerId" = c."id";

ALTER TABLE "Customer" DROP CONSTRAINT "Customer_pkey";
DROP INDEX "Customer_phone_key";
ALTER TABLE "Customer" DROP COLUMN "id";
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_pkey" PRIMARY KEY ("phone");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("phone") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("phone") ON DELETE SET NULL ON UPDATE CASCADE;
