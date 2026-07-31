-- TASK-4501, CTO 정책 4501-④⑤: 실 Production Validation 실행 기록.
--
-- 이 표가 없으면 "검증이 성공했는가"에 답할 근거가 없고, Go-Live 판정은
-- 스모크·전환 판정을 다시 세는 방식이 된다. 같은 사실을 두 번 세면 한 번
-- 좋아진 것이 두 번 좋아진 것처럼 보인다.
--
-- 행이 없는 것은 실패가 아니라 아직 안 한 것이다 — 다만 Go-Live에는 둘 다
-- 통과가 아니다.
CREATE TABLE "validation_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targetUrl" TEXT,
    "targetHost" TEXT,
    "tier" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "realCalls" INTEGER NOT NULL DEFAULT 0,
    "stubbedCalls" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL,
    "error" TEXT,
    "startedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "validation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "validation_runs_status_startedAt_idx" ON "validation_runs"("status", "startedAt");
