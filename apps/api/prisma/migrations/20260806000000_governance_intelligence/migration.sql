-- 마지막 발행 시각 (TASK-2801, CTO 결정 2701-②)
-- publishedAt은 최초 발행 시각으로 유지한다 — 재발행이 최초를 덮어쓰면
-- "언제 처음 나갔는가"에 다시는 답할 수 없다.
ALTER TABLE "contents" ADD COLUMN "lastPublishedAt" TIMESTAMP(3);

-- 이미 발행된 콘텐츠의 마지막 발행 시각은 **감사 이력에서 되살린다.**
-- publishedAt으로 그냥 채우면 이미 재발행된 콘텐츠가 "한 번만 발행"으로
-- 보이는데, 상태 전이 기록에 PUBLISHED 전이가 모두 남아 있으므로(TASK-0704)
-- 그중 가장 늦은 것이 사실이다. 전이 기록이 없는 옛 데이터만 publishedAt으로
-- 되돌린다 — 그때는 그것이 아는 전부다.
UPDATE "contents" c
SET "lastPublishedAt" = COALESCE(
  (
    SELECT MAX(h."createdAt")
    FROM "content_status_history" h
    WHERE h."contentId" = c."id" AND h."toStatus" = 'PUBLISHED'
  ),
  c."publishedAt"
)
WHERE c."publishedAt" IS NOT NULL;

-- 위반 목록과 새로 위반된 콘텐츠 (TASK-2801, CTO 결정 2701-⑤)
-- 전부 nullable이다: NULL은 "그 실행은 목록을 남기지 않았다"(TASK-2701 이전)이고
-- 0이나 빈 배열("위반이 없었다")과 다르다. 이 둘을 섞으면 목록을 두기 전의
-- 위반이 전부 "새로 생겼다"로 보고된다.
ALTER TABLE "governance_scan_runs" ADD COLUMN "violatingIds" JSONB;
ALTER TABLE "governance_scan_runs" ADD COLUMN "newly" JSONB;
ALTER TABLE "governance_scan_runs" ADD COLUMN "newlyCount" INTEGER;
ALTER TABLE "governance_scan_runs" ADD COLUMN "resolvedCount" INTEGER;
