-- TASK-2701 (CTO 결정 2601-②③): 예약 위반 스캔 실행 기록.
--
-- 위반이 **늘었을 때만** 경보하려면(결정 2601-③) 지난 결과가 남아 있어야
-- 한다. 같은 결과로 반복해서 부르지 않는다는 것은 곧 "지난번이 무엇이었는지
-- 기억한다"는 뜻이다.
--
-- 범위(scope)별로 따로 센다 — 프로젝트 하나가 나빠진 것과 전체가 나빠진
-- 것을 한 기준으로 비교하면 어디가 나빠졌는지 알 수 없다.
--
-- 경보를 만들지 않은 실행도 남긴다: "돌았지만 조용했다"와 "돌지 않았다"는
-- 다르고, 그 구분이 없으면 예약이 멈춘 것을 알아챌 수 없다.
CREATE TABLE "governance_scan_runs" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL,
    "blocked" INTEGER NOT NULL,
    "publishedViolations" INTEGER NOT NULL,
    "warned" INTEGER NOT NULL,
    "clean" INTEGER NOT NULL,
    "byCheck" JSONB NOT NULL,
    "verdict" TEXT NOT NULL,
    "previousTotal" INTEGER,
    "total" INTEGER NOT NULL,
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_scan_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "governance_scan_runs_scope_createdAt_idx" ON "governance_scan_runs"("scope", "createdAt");
