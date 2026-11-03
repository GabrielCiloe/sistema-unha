-- Horários por dia da semana (abertura, almoço, fechamento) e endereço usado no link do Google Maps.
ALTER TABLE "Business" ADD COLUMN "schedule" JSONB NOT NULL DEFAULT '{}',
                       ADD COLUMN "mapsAddress" TEXT NOT NULL DEFAULT '';
