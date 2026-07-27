-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ocr_results" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "OcrStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "confidence" DOUBLE PRECISION,
    "raw" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocr_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocr_results_imageId_key" ON "ocr_results"("imageId");

-- CreateIndex
CREATE INDEX "ocr_results_status_idx" ON "ocr_results"("status");

-- AddForeignKey
ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
