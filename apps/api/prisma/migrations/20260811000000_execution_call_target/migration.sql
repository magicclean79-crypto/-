-- 실제 호출 대상 기록 (TASK-3501, Sprint 35 — CTO 정책 3501-④·⑤)
--
-- "이 성공 기록이 누구를 상대로 만들어졌는가"에 답하기 위한 칸이다.
-- 이 칸이 없어서 TASK-3501 라이브 검증에서 판정이 과거에 심어 둔 행을
-- 근거로 "전환 완료"라고 말할 뻔했다.
--
-- 전부 nullable이다 — 옛 기록에는 채울 값이 없고, **null은 "공식
-- 주소였다"가 아니라 "모른다"** 로 읽는다(모르는 것을 통과로 세지 않는다).
-- 파괴적 변경이 없고 재해 복구 절차를 바꾸지 않으므로 Major Migration이
-- 아니다 (결정 1901-① 기준).

ALTER TABLE "executions" ADD COLUMN "endpoint" TEXT;
ALTER TABLE "executions" ADD COLUMN "baseUrl" TEXT;
ALTER TABLE "executions" ADD COLUMN "calledAt" TIMESTAMP(3);

ALTER TABLE "ocr_results" ADD COLUMN "endpoint" TEXT;
ALTER TABLE "ocr_results" ADD COLUMN "baseUrl" TEXT;
ALTER TABLE "ocr_results" ADD COLUMN "calledAt" TIMESTAMP(3);

-- 전환 판정이 "공식 주소로 성공한 기록"을 세므로 그 조회를 받쳐 준다
CREATE INDEX "executions_provider_baseUrl_createdAt_idx"
  ON "executions" ("provider", "baseUrl", "createdAt");
CREATE INDEX "ocr_results_provider_baseUrl_createdAt_idx"
  ON "ocr_results" ("provider", "baseUrl", "createdAt");
