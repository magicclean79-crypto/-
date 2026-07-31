-- 프로젝트별 비용 귀속 (TASK-4201, Sprint 42 — CTO 정책 4201-④)

-- 실행 기록에 프로젝트를 붙인다. "어느 프로젝트가 돈을 쓰는가"는 네
-- 스프린트째 답할 수 없던 질문이고, 그 이유는 이 칸이 없었기 때문이다.
--
-- **nullable이며 옛 기록은 전부 null이다.** null은 "공용"이 아니라 "모른다"다
-- — 집계는 이것을 미배분 칸에 그대로 두고, 프로젝트별로 나눠 얹지 않는다.
-- 배분할 수 없는 것을 배분하면 그 숫자는 관측이 아니라 만들어낸 것이 되고,
-- 그걸로 팀에 비용을 청구하게 된다.
--
-- FK를 걸지 않는 이유: 프로젝트가 지워져도 **비용 기록은 남아야 한다.**
-- ON DELETE SET NULL을 걸면 지워진 프로젝트의 지출이 미배분으로 흘러가
-- "쓴 적 없는 돈"처럼 보인다.
ALTER TABLE "executions" ADD COLUMN "projectId" TEXT;
ALTER TABLE "ocr_results" ADD COLUMN "projectId" TEXT;

-- 기간별 프로젝트 집계가 이 순서로 훑는다
CREATE INDEX "executions_projectId_createdAt_idx" ON "executions"("projectId", "createdAt");
CREATE INDEX "ocr_results_projectId_createdAt_idx" ON "ocr_results"("projectId", "createdAt");
