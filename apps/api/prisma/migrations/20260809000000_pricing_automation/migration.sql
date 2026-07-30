-- 가격 변경 자동화 (TASK-3201, CTO 정책 3201-①③)
--
-- 세 가지를 더한다:
--   1) origin — 사람이 낸 제안(manual)과 시스템이 찾아낸 변화(detected)를 가른다.
--      가르지 않으면 "누가 이 숫자를 처음 말했나"를 알 수 없고, 자동화가 만든
--      제안을 사람이 낸 것처럼 읽는다.
--   2) evidence — 감지의 근거(무엇을 보고 그렇게 판단했는지). 근거 없는 제안은
--      승인할 수 없다.
--   3) effectiveFrom — 발효 시각. 적용은 결정이고 발효는 시각이다: Provider
--      공지가 "8월 1일부터"라면 결정은 오늘 하고 발효는 그날이어야 한다.
ALTER TABLE "pricing_proposals"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual',
  -- 감지 근거 (표본 수·기간·표본 id·차이) — 사람이 읽고 승인한다
  ADD COLUMN "evidence" JSONB,
  -- 발효 시각. 적용 전에는 NULL이고, 적용 시 결정된다.
  -- 기존 적용 기록은 appliedAt을 발효 시각으로 본다 — 그때는 즉시 적용뿐이었다.
  ADD COLUMN "effectiveFrom" TIMESTAMP(3);

UPDATE "pricing_proposals"
   SET "effectiveFrom" = "appliedAt"
 WHERE "appliedAt" IS NOT NULL;

-- 실효 단가 해석이 "발효된 것"만 시각순으로 읽는다 (예약분은 아직 제외)
CREATE INDEX "pricing_proposals_target_key_effectiveFrom_idx"
  ON "pricing_proposals"("target", "key", "effectiveFrom");
