-- CreateTable
CREATE TABLE "design_reviews" (
    "id" TEXT NOT NULL,
    "imageIds" TEXT[],
    "category" TEXT NOT NULL,
    "notes" TEXT,
    "result" JSONB,
    "provider" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_reviews_category_idx" ON "design_reviews"("category");
