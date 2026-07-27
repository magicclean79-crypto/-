-- Project Domain Foundation (TASK-0301)
-- Project를 최상위 루트 엔티티로 도입한다. 데이터 보존형:
-- 기존 상품마다 동일 id/이름의 프로젝트를 생성해 백필하므로
-- product_objects.projectId 값은 재매핑 없이 그대로 유효하다.

-- 1) projects 테이블
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- 2) 백필: 기존 상품 1건당 프로젝트 1건 (id 동일)
INSERT INTO "projects" ("id", "name", "description", "createdAt", "updatedAt")
SELECT "id", "name", "description", "createdAt", "updatedAt" FROM "products";

-- 3) products.projectId (백필 후 NOT NULL)
ALTER TABLE "products" ADD COLUMN "projectId" TEXT;
UPDATE "products" SET "projectId" = "id";
ALTER TABLE "products" ALTER COLUMN "projectId" SET NOT NULL;
CREATE INDEX "products_projectId_idx" ON "products"("projectId");
ALTER TABLE "products" ADD CONSTRAINT "products_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) product_objects.projectId FK 재지정: products → projects (값은 이미 유효)
ALTER TABLE "product_objects" DROP CONSTRAINT "product_objects_projectId_fkey";
ALTER TABLE "product_objects" ADD CONSTRAINT "product_objects_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
