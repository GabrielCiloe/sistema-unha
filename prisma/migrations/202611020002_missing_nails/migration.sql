-- Manutencao de unha: preco por unha faltando no servico; quantidade e preco unitario copiados no item da reserva.
ALTER TABLE "Service" ADD COLUMN "missingNailPriceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppointmentItem" ADD COLUMN "missingNails" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppointmentItem" ADD COLUMN "missingNailPriceCents" INTEGER NOT NULL DEFAULT 0;
