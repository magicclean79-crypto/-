-- Content를 Project/ProductObject 소속으로 재구성 (TASK-0303). contents 테이블은 미사용(0건)이라 안전.
-- DropForeignKey
ALTER TABLE "contents" DROP CONSTRAINT "contents_productId_fkey";

-- DropIndex
DROP INDEX "contents_productId_idx";

-- AlterTable
ALTER TABLE "contents" DROP COLUMN "productId",
ADD COLUMN     "productObjectId" TEXT,
ADD COLUMN     "projectId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "contents_projectId_idx" ON "contents"("projectId");

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_productObjectId_fkey" FOREIGN KEY ("productObjectId") REFERENCES "product_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

