-- Product Detail Engine LEVEL 1 (T1-188)
-- 새 파이프라인 기반 — 기존 테이블(projects/products/images 등)은 전혀
-- 건드리지 않는다. Level1 접두사로 완전히 분리된 새 테이블 3개 + enum
-- 1개만 추가한다.

-- CreateEnum
CREATE TYPE "Level1AssetRole" AS ENUM ('ACTUAL_PRODUCT', 'PACKAGING', 'LABEL', 'SPEC', 'BARCODE', 'MANUAL', 'LIFESTYLE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "level1_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level1_products" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "category" TEXT,
    "materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dimensions" TEXT,
    "includedComponents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin" TEXT,
    "claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "uncertainFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level1_assets" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "role" "Level1AssetRole" NOT NULL DEFAULT 'UNKNOWN',
    "roleSetBy" TEXT DEFAULT 'manual',
    "roleSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level1_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "level1_products_projectId_idx" ON "level1_products"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "level1_assets_objectKey_key" ON "level1_assets"("objectKey");

-- CreateIndex
CREATE INDEX "level1_assets_productId_idx" ON "level1_assets"("productId");

-- AddForeignKey
ALTER TABLE "level1_products" ADD CONSTRAINT "level1_products_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "level1_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level1_assets" ADD CONSTRAINT "level1_assets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "level1_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
