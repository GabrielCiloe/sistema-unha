-- AlterTable
ALTER TABLE "Business" ADD COLUMN "coverVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "hasCoverDesktop" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hasCoverMobile" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BusinessCover" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCover_pkey" PRIMARY KEY ("id")
);
