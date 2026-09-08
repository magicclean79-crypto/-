-- Product Detail Engine LEVEL 1 원샷 생성 (T1-189)
-- level1_projects/level1_products/level1_assets(T1-188)는 전혀 건드리지
-- 않는다. 새 테이블 1개 + enum 1개만 추가한다.

-- CreateEnum
CREATE TYPE "Level1GenerationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "level1_generations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "Level1GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "referenceAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputObjectKey" TEXT,
    "outputMimeType" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "level1_generations_productId_idx" ON "level1_generations"("productId");

-- AddForeignKey (DB-level referential integrity; Level1Product 모델 자체는 수정하지 않음)
ALTER TABLE "level1_generations" ADD CONSTRAINT "level1_generations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "level1_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
