-- AlterTable
ALTER TABLE "product_profiles" ADD COLUMN "designProfile" JSONB;
ALTER TABLE "product_profiles" ADD COLUMN "designProfileGeneratedAt" TIMESTAMP(3);
