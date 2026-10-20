-- hasLogo: indica se existe logo (logoVersion so serve para invalidar o cache da imagem).
ALTER TABLE "Business" ADD COLUMN "hasLogo" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Business" SET "hasLogo" = EXISTS (SELECT 1 FROM "BusinessLogo");
