-- TASK-1601 Production Verification & Operational Readiness (Sprint 16)

-- CTO 결정 1501-③: Dead Letter는 삭제하지 않고 90일 후 보관한다.
ALTER TYPE "NotificationQueueStatus" ADD VALUE 'ARCHIVED';
ALTER TABLE "notification_queue" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 백업 실행 이력 — "성공"이라도 0바이트면 복원할 수 없으므로 크기를 남긴다
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "sizeBytes" BIGINT,
    "fileName" TEXT,
    "durationMs" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "backup_runs_createdAt_idx" ON "backup_runs"("createdAt");

-- 복원 검증 이력 — 복원해 보지 않은 백업은 백업이 아니다
CREATE TABLE "restore_runs" (
    "id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "tables" INTEGER,
    "fileName" TEXT,
    "durationMs" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "restore_runs_createdAt_idx" ON "restore_runs"("createdAt");
