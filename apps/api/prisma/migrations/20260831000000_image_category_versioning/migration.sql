-- CreateEnum
CREATE TYPE "ImageCategory" AS ENUM ('HERO', 'USAGE_SCENE', 'DETAIL', 'FEATURE_HIGHLIGHT', 'COMPONENTS', 'OTHER');

-- AlterTable
ALTER TABLE "images" ADD COLUMN "category" "ImageCategory";
ALTER TABLE "images" ADD COLUMN "groupVersion" INTEGER;
ALTER TABLE "images" ADD COLUMN "style" TEXT;
ALTER TABLE "images" ADD COLUMN "selected" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "images_sourceImageId_category_idx" ON "images"("sourceImageId", "category");
