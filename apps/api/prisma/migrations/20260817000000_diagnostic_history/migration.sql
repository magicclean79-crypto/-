-- 진단 이력 · 만료 초안 되살림 (TASK-4101, Sprint 41 — CTO 정책 4101-②④)

-- 진단 실행 1건. 이력이 없으면 "오늘 실패 2건"이 **새로 생긴 것인지 계속
-- 그랬던 것인지** 알 수 없고, 그 둘은 완전히 다른 소식이다.
--
-- `tier`를 함께 적는 이유(정책 4101-③): 스테이징의 진단과 운영의 진단은
-- 판정 기준이 다르므로 **같은 단계끼리만 비교**해야 한다. 섞어서 비교하면
-- "어제 정상이던 것이 오늘 실패"가 사실은 다른 환경의 이야기가 된다.
CREATE TABLE "diagnostic_runs" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "ok" INTEGER NOT NULL,
    "warn" INTEGER NOT NULL,
    "fail" INTEGER NOT NULL,
    "unknown" INTEGER NOT NULL,
    -- 항목 전체를 남긴다 — 개수만 남기면 "무엇이" 나빠졌는지 비교할 수 없다
    "checks" JSONB NOT NULL,
    "detail" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostic_runs_pkey" PRIMARY KEY ("id")
);

-- 비교는 "같은 tier·같은 stage의 직전 실행"을 찾는다
CREATE INDEX "diagnostic_runs_tier_stage_ranAt_idx" ON "diagnostic_runs"("tier", "stage", "ranAt");
CREATE INDEX "diagnostic_runs_ranAt_idx" ON "diagnostic_runs"("ranAt");

-- 만료된 초안을 되살린 기록 (정책 4101-④).
--
-- **`expiredAt`을 지우지 않는다** — 만료됐던 사실을 지우면 목록은 깨끗해지고
-- 이력은 "확인된 장애 1건"이 된다. 그러면 나중에 이력을 읽는 사람이 "우리
-- 팀은 초안을 잘 처리한다"고 읽는다. 실제로는 늦게 본 것인데도.
ALTER TABLE "incidents" ADD COLUMN "revivedAt" TIMESTAMP(3);
ALTER TABLE "incidents" ADD COLUMN "revivedById" TEXT;
-- confirm | dismiss | reopen
ALTER TABLE "incidents" ADD COLUMN "revivalAction" TEXT;
ALTER TABLE "incidents" ADD COLUMN "revivalReason" TEXT;
-- 만료된 지 얼마나 지나서 손댔는가 (ms). 하루와 석 달이 같아 보이면
-- 이 지표는 개선 대상이 되지 못한다.
ALTER TABLE "incidents" ADD COLUMN "revivalLatenessMs" INTEGER;

CREATE INDEX "incidents_revivedAt_idx" ON "incidents"("revivedAt");
