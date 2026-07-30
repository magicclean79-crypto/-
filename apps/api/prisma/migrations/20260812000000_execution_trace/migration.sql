-- 요청 추적 기록 (TASK-3601, Sprint 36 — CTO 정책 3601-②)
--
-- 한 번의 사용자 요청이 LLM·OCR을 여러 번 부른다. 그 호출들을 묶는 끈이
-- 없으면 "이 요청이 얼마를 썼는가"·"이 실패가 그 요청의 것인가"에 답할 수
-- 없고, 장애 때 로그와 기록을 손으로 맞춰 보게 된다.
--
-- 전부 nullable이다 — 옛 기록에는 채울 값이 없고, **null은 "추적이 없었다"가
-- 아니라 "모른다"** 로 읽는다. 파괴적 변경이 없고 재해 복구 절차를 바꾸지
-- 않으므로 Major Migration이 아니다 (결정 1901-① 기준).

ALTER TABLE "executions" ADD COLUMN "requestId" TEXT;
ALTER TABLE "executions" ADD COLUMN "traceId" TEXT;

ALTER TABLE "ocr_results" ADD COLUMN "requestId" TEXT;
ALTER TABLE "ocr_results" ADD COLUMN "traceId" TEXT;

-- 한 요청이 부른 호출을 모아 보는 조회를 받쳐 준다
CREATE INDEX "executions_requestId_idx" ON "executions" ("requestId");
CREATE INDEX "ocr_results_requestId_idx" ON "ocr_results" ("requestId");
