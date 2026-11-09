-- Product Detail Engine LEVEL 2 다중 상세페이지 이미지 분할 생성 (T1-191)
-- level1_projects/level1_products/level1_assets(T1-188), level1_generations(T1-189)는
-- 전혀 건드리지 않는다. 새 테이블 2개 + enum 2개만 추가한다.

-- CreateEnum
CREATE TYPE "Level1MultiGenerationStatus" AS ENUM ('PENDING', 'ANALYZING', 'GENERATING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "Level1PageStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "level1_multi_generations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "Level1MultiGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "analysisProvider" TEXT,
    "analysisModel" TEXT,
    "analysisPromptText" TEXT,
    "analysisRawText" TEXT,
    "verifiedProductFacts" JSONB,
    "actualProductAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_multi_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level1_detail_pages" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "pageRole" TEXT NOT NULL,
    "title" TEXT,
    "status" "Level1PageStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "model" TEXT,
    "promptText" TEXT,
    "referenceAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputObjectKey" TEXT,
    "outputMimeType" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_detail_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "level1_multi_generations_productId_idx" ON "level1_multi_generations"("productId");

-- CreateIndex
CREATE INDEX "level1_detail_pages_generationId_idx" ON "level1_detail_pages"("generationId");

-- AddForeignKey (DB-level referential integrity; Level1Product 모델 자체는 수정하지 않음)
ALTER TABLE "level1_multi_generations" ADD CONSTRAINT "level1_multi_generations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "level1_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level1_detail_pages" ADD CONSTRAINT "level1_detail_pages_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "level1_multi_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
