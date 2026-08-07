-- CreateEnum
CREATE TYPE "ProductProfileStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "product_profiles" (
    "id" TEXT NOT NULL,
    "imageIds" TEXT[],
    "projectId" TEXT,
    "status" "ProductProfileStatus" NOT NULL DEFAULT 'PENDING',
    "ocrText" TEXT,
    "imageFeatures" JSONB,
    "profile" JSONB,
    "provider" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_profiles_projectId_idx" ON "product_profiles"("projectId");

-- CreateIndex
CREATE INDEX "product_profiles_status_idx" ON "product_profiles"("status");

-- AddForeignKey
ALTER TABLE "product_profiles" ADD CONSTRAINT "product_profiles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
