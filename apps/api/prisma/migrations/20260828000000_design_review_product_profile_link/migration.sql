-- AlterTable
ALTER TABLE "design_reviews" ADD COLUMN "productProfileId" TEXT;

-- CreateIndex
CREATE INDEX "design_reviews_productProfileId_idx" ON "design_reviews"("productProfileId");
