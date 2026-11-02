-- Antecedencia minima em dias para a cliente agendar. 2 = a partir de depois de amanha; 0 = hoje mesmo.
ALTER TABLE "Business" ADD COLUMN "minLeadDays" INTEGER NOT NULL DEFAULT 2;
