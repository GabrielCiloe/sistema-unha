-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "logoVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tagline" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "themeAccent" TEXT NOT NULL DEFAULT '#ec4899',
ADD COLUMN     "themeBg" TEXT NOT NULL DEFAULT '#0f0c1b',
ADD COLUMN     "themeConfirm" TEXT NOT NULL DEFAULT '#10b981',
ADD COLUMN     "themePrimary" TEXT NOT NULL DEFAULT '#7c3aed',
ADD COLUMN     "themeSurface" TEXT NOT NULL DEFAULT '#1e192b',
ADD COLUMN     "themeText" TEXT NOT NULL DEFAULT '#ffffff';

-- CreateTable
CREATE TABLE "BusinessLogo" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessLogo_pkey" PRIMARY KEY ("id")
);

