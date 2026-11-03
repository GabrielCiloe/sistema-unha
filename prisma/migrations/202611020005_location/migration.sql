-- Localização do estúdio (marcada no mapa em Configurações); vira link do Google Maps nas mensagens.
ALTER TABLE "Business" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
