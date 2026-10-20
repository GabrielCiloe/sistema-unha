-- Pausa opcional (em minutos) entre atendimentos. 0 = um atendimento comeca assim que o anterior termina.
ALTER TABLE "Business" ADD COLUMN "bufferMinutes" INTEGER NOT NULL DEFAULT 0;
