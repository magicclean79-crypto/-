-- Drill Requirement (TASK-1901, Sprint 19 — CTO 결정 1801-⑤)
--
-- 달력이 아니라 변경이 리허설을 부른다. DR 절차 변경 · DB 대규모 변경 ·
-- PITR 도입이 등록되면, 주기가 남아 있어도 리허설을 다시 해야 한다.

CREATE TABLE "drill_requirements" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "satisfiedAt" TIMESTAMP(3),
    "satisfiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drill_requirements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drill_requirements_satisfiedAt_idx" ON "drill_requirements"("satisfiedAt");
