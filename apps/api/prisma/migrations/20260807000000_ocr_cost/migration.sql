-- OCR 비용 편입 (TASK-3001, CTO 결정 2901-④)
-- OCR도 호출당 과금되는 AI 호출인데 비용이 어디에도 기록되지 않았다 —
-- 예산 상한이 LLM 지출만 보고 있었으므로 실 OCR 엔진을 붙인 순간부터
-- **예산 밖에서 돈이 나가는 경로**가 생겼다.
--
-- cost는 nullable이다: NULL은 "가격표에 없어 산정하지 못했다"(미산정)이고
-- 0("과금 없는 엔진")과 다르다. 이 둘을 섞으면 예산 상한이 조용히 무력해진다.
ALTER TABLE "ocr_results" ADD COLUMN "cost" DECIMAL(12, 6);

-- 과금 단위 수 — 이미지 1장 · 검사 1종이 1단위다. 기존 행은 1로 둔다
-- (그때도 호출 1건이었다는 것이 아는 전부다).
ALTER TABLE "ocr_results" ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1;

-- 비용 집계는 기간으로 자른다 (일·월 예산) — 인덱스가 없으면 전체 스캔이다.
CREATE INDEX "ocr_results_createdAt_idx" ON "ocr_results"("createdAt");
