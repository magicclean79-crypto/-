-- TASK-2601 (CTO 결정 2501-⑤): 발행 판정 기록의 보관 시각.
--
-- 경보(결정 1302-④)·Dead Letter(결정 1501-③)와 같은 정책이다:
-- **삭제하지 않고** 90일 경과 후 보관으로 옮겨 현황 조회에서 비켜 둔다.
-- 삭제는 되돌릴 수 없고 "그때 왜 막혔나"를 확인할 방법을 영원히 없앤다.
--
-- 경보와 다른 점: 판정 기록에는 해소라는 개념이 없는 시점 기록이므로
-- **작성 시각**(createdAt)을 기준으로 센다.
ALTER TABLE "content_governance_checks" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "content_governance_checks_archivedAt_createdAt_idx" ON "content_governance_checks"("archivedAt", "createdAt");
