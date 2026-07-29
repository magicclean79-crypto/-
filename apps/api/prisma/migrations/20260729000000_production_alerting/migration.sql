-- TASK-1302 Production Automation & Alerting (Sprint 13)

-- CTO 결정 1301-③: 진단 호출(Health Check·Live Check)을 운영 통계에서 분리한다.
-- feature를 새로 만들지 않고 메타데이터 한 칸으로 구분한다 (0601 승인의 feature 4종 유지).
ALTER TABLE "executions" ADD COLUMN "diagnostic" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "executions_diagnostic_createdAt_idx" ON "executions"("diagnostic", "createdAt");

-- 경보
CREATE TYPE "AlertLevel" AS ENUM ('WARNING', 'CRITICAL');
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'RESOLVED');

CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstRaisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRaisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alerts_key_key" ON "alerts"("key");
CREATE INDEX "alerts_status_lastRaisedAt_idx" ON "alerts"("status", "lastRaisedAt");

-- 예약 점검 실행 이력
CREATE TABLE "check_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL,
    "alertsRaised" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "check_runs_job_createdAt_idx" ON "check_runs"("job", "createdAt");
