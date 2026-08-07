-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('ORIGINAL', 'BACKGROUND_REMOVED', 'BACKGROUND_GENERATED', 'COMPOSITED');

-- AlterTable
ALTER TABLE "images" ADD COLUMN "kind" "ImageKind" NOT NULL DEFAULT 'ORIGINAL';
ALTER TABLE "images" ADD COLUMN "sourceImageId" TEXT;
ALTER TABLE "images" ADD COLUMN "generationMetadata" JSONB;

-- CreateIndex
CREATE INDEX "images_sourceImageId_idx" ON "images"("sourceImageId");
