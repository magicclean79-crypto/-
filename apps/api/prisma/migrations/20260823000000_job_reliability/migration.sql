-- TASK-4603, Sprint 46: 작업 신뢰성 (예외 분류 · 로그 · 체크포인트 · 계측).
--
-- TASK-3601의 requestId는 요청 단위다. 요청이 끝나도 작업은 계속되므로
-- 작업 자체의 끈이 따로 필요하다. 둘을 같이 남겨 로그와 기록을 맞춰 본다.
--
-- 세 표 전부 **추가만**이며 기존 표를 건드리지 않는다.

CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    -- 입력 지문. 다르면 이어하지 않고 처음부터 한다 — 바뀐 입력에 옛 결과를
    -- 붙이면 그 결과는 어느 입력의 것도 아니다.
    "fingerprint" TEXT NOT NULL,
    -- [{ stage, done, output, at }] — 끝난 단계만 건너뛴다
    "checkpoints" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "failureKind" TEXT,
    -- 운영자용 원문과 사용자용 문장을 따로 둔다. 원문에 무엇이 들어 있는지
    -- 우리는 미리 알 수 없으므로 사용자에게 그대로 보여 주지 않는다.
    "lastError" TEXT,
    "userMessage" TEXT,
    "totalMs" INTEGER,
    "actorId" TEXT,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_runs_kind_startedAt_idx" ON "job_runs"("kind", "startedAt");
CREATE INDEX "job_runs_status_startedAt_idx" ON "job_runs"("status", "startedAt");

-- 작업이 남긴 로그. 비밀은 적기 전에 가려서 들어온다 — 로그는 가장 많이
-- 복사되는 텍스트이고, 가리는 쪽이 안전한 실수다.
CREATE TABLE "job_events" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_events_jobId_at_idx" ON "job_events"("jobId", "at");
CREATE INDEX "job_events_level_at_idx" ON "job_events"("level", "at");

-- 단계별 계측. 추세를 내려면 실행마다 흩어진 값이 아니라 조회 가능한 행이
-- 필요하다. 토큰을 모르면 NULL이며 0으로 채우지 않는다 — 채우면 합계가
-- 실제보다 작아지고 그 합계로 비용을 재면 청구서와 어긋난다.
CREATE TABLE "job_stage_metrics" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    -- 이 단계가 쓴 메모리가 아니다 — 프로세스 전체 값이고, 같은 시간에 돈
    -- 다른 일의 몫이 섞여 있다. 그래도 남기는 이유는 힙이 크게 늘었다면
    -- 그것이 어느 작업의 것이든 봐야 할 신호이기 때문이다.
    "processHeapDeltaBytes" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_stage_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_stage_metrics_kind_stage_at_idx" ON "job_stage_metrics"("kind", "stage", "at");
CREATE INDEX "job_stage_metrics_jobId_idx" ON "job_stage_metrics"("jobId");

ALTER TABLE "job_events"
  ADD CONSTRAINT "job_events_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "job_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_stage_metrics"
  ADD CONSTRAINT "job_stage_metrics_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "job_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
