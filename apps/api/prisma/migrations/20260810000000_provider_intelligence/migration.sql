-- Provider Intelligence (TASK-3301, CTO 정책 3301-①②③④)
--
-- 1) 2단계 승인 (정책 3301-②): 시스템이 만든 제안은 운영에서 다른 ADMIN의
--    최종 승인을 한 번 더 거친다. 사람이 낸 제안은 제안자와 승인자가 이미
--    둘이지만, 시스템 제안은 승인자 한 명이 곧 전부이기 때문이다.
ALTER TABLE "pricing_proposals"
  ADD COLUMN "confirmedBy"     TEXT,
  ADD COLUMN "confirmedAt"     TIMESTAMP(3),
-- 2) 예약 취소 (정책 3301-③): **삭제하지 않는다.** 적용은 실제로 있었던
--    일이고, 그 결정을 지우면 "왜 그때 그 단가가 예약됐다가 사라졌는가"에
--    아무도 답할 수 없다. CANCELLED로 남기고 계산에서만 뺀다.
  ADD COLUMN "cancelledBy"     TEXT,
  ADD COLUMN "cancelledAt"     TIMESTAMP(3),
  ADD COLUMN "cancelledReason" TEXT;

-- 3) 감지 실행 이력 (정책 3301-④): Provider별 주기를 지키려면 "언제 마지막으로
--    봤는가"가 있어야 한다. 그리고 이 기록이 없으면 **"감지 0건"과 "감지를 안
--    돌렸다"를 구분할 수 없다** — 조용한 것과 안 본 것은 다르다.
CREATE TABLE "price_detection_runs" (
  "id"        TEXT NOT NULL,
  -- llm | ocr
  "target"    TEXT NOT NULL,
  -- Provider·엔진 이름 (프로젝트별 구분은 두지 않는다 — 정책 3301-④)
  "provider"  TEXT NOT NULL,
  -- records(우리 기록 대조) | published(외부 공지 대조)
  "source"    TEXT NOT NULL,
  "ranAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 본 표본 수 · 감지 건수 — 0건도 사실이므로 남긴다
  "samples"   INTEGER NOT NULL DEFAULT 0,
  "changes"   INTEGER NOT NULL DEFAULT 0,
  -- 건너뛴 이유 (주기 미도래 등) — 돌지 않은 것도 기록이다
  "skipped"   TEXT,
  "detail"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "price_detection_runs_pkey" PRIMARY KEY ("id")
);

-- Provider별 "마지막으로 본 시각"을 읽는다
CREATE INDEX "price_detection_runs_provider_ranAt_idx"
  ON "price_detection_runs"("provider", "ranAt");
CREATE INDEX "price_detection_runs_ranAt_idx"
  ON "price_detection_runs"("ranAt");
