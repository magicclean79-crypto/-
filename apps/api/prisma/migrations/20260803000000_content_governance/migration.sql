-- TASK-2501: 발행 거버넌스 판정 기록.
--
-- 규칙은 나중에 바뀐다. 지금 통과한 콘텐츠가 반년 뒤 기준으로는 위반일 수
-- 있고, 그때 "왜 발행됐지"에 답하려면 **그때의 기준**이 남아 있어야 한다.
-- 그래서 판정 결과와 함께 적용된 기준(금지어 수·고지 id)을 남긴다.
--
-- 막힌 기록도 남긴다 — 무엇이 막았고 언제 풀렸는지가 없으면
-- "왜 이렇게 늦게 발행됐지"에 아무도 답할 수 없다.
CREATE TABLE "content_governance_checks" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "blockedBy" TEXT[],
    "checks" JSONB NOT NULL,
    "appliedRules" JSONB NOT NULL,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_governance_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_governance_checks_contentId_createdAt_idx" ON "content_governance_checks"("contentId", "createdAt");

ALTER TABLE "content_governance_checks" ADD CONSTRAINT "content_governance_checks_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
