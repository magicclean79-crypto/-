-- TASK-0402 Structured Memory Foundation
-- 1) 기존 프로젝트 메모형 Memory를 ProjectMemory로 보존 (테이블 이름 변경 — 데이터 보존)
ALTER TABLE "memories" RENAME TO "project_memories";
ALTER INDEX "memories_pkey" RENAME TO "project_memories_pkey";
ALTER INDEX "memories_projectId_idx" RENAME TO "project_memories_projectId_idx";
ALTER TABLE "project_memories" RENAME CONSTRAINT "memories_projectId_fkey" TO "project_memories_projectId_fkey";

-- 2) 표준 Structured Memory (scope/scopeId/key/value/description)
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_scope_scopeId_idx" ON "memories"("scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "memories_scope_scopeId_key_key" ON "memories"("scope", "scopeId", "key");
