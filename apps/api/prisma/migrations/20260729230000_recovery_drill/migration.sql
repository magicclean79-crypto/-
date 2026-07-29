-- Recovery Drill (TASK-1801, Sprint 18 — CTO 결정 1701-⑤)
--
-- 분기 1회 복구 리허설을 운영 표준으로 채택했다. 기록이 없으면 체크리스트의
-- "복구 절차 숙지"는 영원히 manual로 남고, 아무도 하지 않아도 아무 일도
-- 일어나지 않는다. 기록해야 판정 대상이 된다.

CREATE TABLE "recovery_drills" (
    "id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "performedBy" TEXT NOT NULL,
    "durationMs" INTEGER,
    "findings" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_drills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recovery_drills_createdAt_idx" ON "recovery_drills"("createdAt");
