-- 가격표 변경 거버넌스 (TASK-3101, CTO 정책 3101-①)
-- 단가는 돈의 기준이다. 코드 한 줄로 바로 반영하면 누가 왜 바꿨는지 남지 않고,
-- 예산·리포트의 숫자가 어느 시점부터 달라졌는지 아무도 설명할 수 없다.
-- 검토 → 승인 → 적용 절차를 기록으로 남긴다.
CREATE TABLE "pricing_proposals" (
  "id"             TEXT NOT NULL,
  -- llm | ocr
  "target"         TEXT NOT NULL,
  -- LLM은 모델 이름, OCR은 엔진 이름
  "key"            TEXT NOT NULL,
  -- 제안 단가 (llm: inputPerMillion/outputPerMillion · ocr: perUnitUsd)
  "price"          JSONB NOT NULL,
  -- 제안 당시의 유효 단가 — 가격표에 없던 항목이면 NULL.
  -- "무엇에서 무엇으로" 바뀌는지가 남아야 나중에 판단을 되짚을 수 있다.
  "currentPrice"   JSONB,
  "reason"         TEXT NOT NULL,
  -- DRAFT | REVIEWED | APPROVED | APPLIED | REJECTED (단계를 건너뛸 수 없다)
  "stage"          TEXT NOT NULL DEFAULT 'DRAFT',
  -- 누가 언제 했는지 단계마다 남긴다 — 절차의 증거다
  "proposedBy"     TEXT,
  "reviewedBy"     TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "approvedBy"     TEXT,
  "approvedAt"     TIMESTAMP(3),
  "appliedBy"      TEXT,
  "appliedAt"      TIMESTAMP(3),
  "rejectedBy"     TEXT,
  "rejectedAt"     TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pricing_proposals_pkey" PRIMARY KEY ("id")
);

-- 실효 단가 해석이 "적용된 것"만 시각순으로 읽는다 (시점별 단가)
CREATE INDEX "pricing_proposals_target_key_appliedAt_idx"
  ON "pricing_proposals"("target", "key", "appliedAt");
-- 목록은 단계별·최신순으로 본다
CREATE INDEX "pricing_proposals_stage_createdAt_idx"
  ON "pricing_proposals"("stage", "createdAt");
