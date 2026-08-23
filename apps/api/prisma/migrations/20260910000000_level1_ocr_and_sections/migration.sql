-- Product Detail Engine LEVEL 2 OCR 강화 + 섹션별 제품 설명 (T1-196)
-- level1_products/level1_assets(T1-188)는 전혀 건드리지 않는다. 새 테이블
-- 1개(OCR 결과, OcrResult(Image용)와 같은 목적의 Level1Asset 버전) +
-- level1_multi_generations/level1_detail_pages에 컬럼만 추가한다.

-- CreateTable
CREATE TABLE "level1_asset_ocr_results" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "OcrStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "extractedText" TEXT,
    "rawJson" JSONB,
    "boundingBoxes" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_asset_ocr_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "level1_asset_ocr_results_assetId_idx" ON "level1_asset_ocr_results"("assetId");

-- AddForeignKey (DB-level referential integrity; Level1Asset 모델 자체는 수정하지 않음)
ALTER TABLE "level1_asset_ocr_results" ADD CONSTRAINT "level1_asset_ocr_results_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "level1_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: level1_multi_generations — OCR 근거 + Product Facts 후보 + 교차 검증
ALTER TABLE "level1_multi_generations" ADD COLUMN "ocrAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "level1_multi_generations" ADD COLUMN "ocrFactsCandidates" JSONB;
ALTER TABLE "level1_multi_generations" ADD COLUMN "factsVerification" JSONB;

-- AlterTable: level1_detail_pages — 섹션별 제품 설명
ALTER TABLE "level1_detail_pages" ADD COLUMN "sectionDescription" TEXT;
ALTER TABLE "level1_detail_pages" ADD COLUMN "evidenceAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "level1_detail_pages" ADD COLUMN "descriptionConfidence" DOUBLE PRECISION;
