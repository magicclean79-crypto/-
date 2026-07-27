-- CreateEnum
CREATE TYPE "ProductObjectStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateTable
CREATE TABLE "product_objects" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProductObjectStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "attributes" JSONB,
    "ocrSummary" JSONB,
    "visionSummary" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_objects_projectId_idx" ON "product_objects"("projectId");

-- CreateIndex
CREATE INDEX "product_objects_status_idx" ON "product_objects"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_objects_projectId_version_key" ON "product_objects"("projectId", "version");

-- AddForeignKey
ALTER TABLE "product_objects" ADD CONSTRAINT "product_objects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

