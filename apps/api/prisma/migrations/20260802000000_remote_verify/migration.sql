-- TASK-2101 (CTO 결정 2001-②): 원격 사본 자동 대조 결과를 남긴다.
-- 결과가 남지 않으면 주 1회 자동 대조를 넣어도 화면은 계속
-- "확인하지 않았습니다"라고 말한다.
ALTER TABLE "backup_runs" ADD COLUMN "remoteCheckedAt" TIMESTAMP(3);
ALTER TABLE "backup_runs" ADD COLUMN "remoteVerdict" TEXT;

CREATE INDEX "backup_runs_remoteCheckedAt_idx" ON "backup_runs"("remoteCheckedAt");
