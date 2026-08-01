-- TASK-4701, Sprint 47 — Enterprise AI Reliability Expansion
--
-- 전부 **더하기만** 합니다. 지우거나 바꾸는 것이 없으므로 Major Migration이
-- 아닙니다(결정 1901-①). 새 칸은 모두 nullable이거나 기본값이 있으며,
-- 옛 행에는 null이 들어갑니다 — 그리고 **null일 때 비용 계산은 예전과
-- 한 푼도 다르지 않습니다.**

-- ── 지시 2: 토큰 상세 ────────────────────────────────────────
-- Provider마다 usage의 뜻이 달라 합계가 어느 쪽으로도 틀리고 있었습니다.
ALTER TABLE "executions" ADD COLUMN "cachedInputTokens" INTEGER;
ALTER TABLE "executions" ADD COLUMN "cacheWriteTokens" INTEGER;
ALTER TABLE "executions" ADD COLUMN "reasoningTokens" INTEGER;

-- ── 지시 3: 자동 이어하기 ────────────────────────────────────
-- `running`으로 적혀 있는 것과 실제로 돌고 있는 것은 다릅니다.
ALTER TABLE "job_runs" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "job_runs" ADD COLUMN "autoResumeRounds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "job_runs" ADD COLUMN "autoResumeAt" TIMESTAMP(3);

-- 옛 행에는 갱신 시각이 없습니다. `startedAt`으로 채우는 이유: null로 두면
-- 대기 계산이 "한 번도 갱신되지 않았다"를 "방금 갱신됐다"로 읽을 수 있고,
-- 그러면 옛 작업이 영원히 대기 상태로 남습니다.
ALTER TABLE "job_runs" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "job_runs" SET "updatedAt" = "startedAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "job_runs" ALTER COLUMN "updatedAt" SET NOT NULL;

-- 자동 이어하기가 훑는 축 — 살아 있지 않은 작업만 봅니다.
CREATE INDEX "job_runs_status_heartbeatAt_idx" ON "job_runs"("status", "heartbeatAt");

-- 단계별 비용 (지시 2). 옛 행은 null이며, null은 "공짜"가 아니라 "안 쟀다"입니다.
ALTER TABLE "job_stage_metrics" ADD COLUMN "costUsd" DECIMAL(12,6);
ALTER TABLE "job_stage_metrics" ADD COLUMN "unpricedCalls" INTEGER;
