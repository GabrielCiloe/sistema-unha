-- Ajuste de horário para uma data específica (sobrepõe a grade semanal).
CREATE TABLE "DayOverride" (
  "date" TEXT NOT NULL,
  "on" BOOLEAN NOT NULL,
  "open" INTEGER NOT NULL,
  "lunchStart" INTEGER,
  "lunchEnd" INTEGER,
  "close" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DayOverride_pkey" PRIMARY KEY ("date")
);
