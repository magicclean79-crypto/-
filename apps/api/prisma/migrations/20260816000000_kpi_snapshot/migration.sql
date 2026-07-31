-- KPI 스냅샷 · 장애 초안 만료 (TASK-4001, Sprint 40 — CTO 정책 4001-①②)

-- 초안이 아무도 판단하지 않은 채 수명을 넘긴 시각.
-- **기각(dismissedAt)과 다른 칸이다** — 기각은 "아무것도 아니었다"는 사람의
-- 판단이고, 만료는 "아무도 판단하지 않았다"는 사실이다. 같은 칸에 넣으면
-- 나중에 이력을 읽는 사람이 방치를 기각 실적으로 읽는다.
ALTER TABLE "incidents" ADD COLUMN "expiredAt" TIMESTAMP(3);

-- 수명을 넘긴 초안을 찾는 질의는 status=DRAFT를 오래된 순으로 훑는다.
-- 기존 (status, startedAt) 인덱스는 startedAt이 장애 시작 시각이라
-- 초안이 만들어진 시각과 다르다.
CREATE INDEX "incidents_status_createdAt_idx" ON "incidents"("status", "createdAt");

-- KPI 한 시점의 값. value가 NULL일 수 있는 것이 핵심이다 —
-- 표본이 없어 값을 낼 수 없었던 시점을 0으로 적으면 "완벽한 날"이 된다.
CREATE TABLE "kpi_snapshots" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "thresholdGood" DOUBLE PRECISION,
    "thresholdWatch" DOUBLE PRECISION,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kpi_snapshots_kpiId_takenAt_idx" ON "kpi_snapshots"("kpiId", "takenAt");
CREATE INDEX "kpi_snapshots_takenAt_idx" ON "kpi_snapshots"("takenAt");
