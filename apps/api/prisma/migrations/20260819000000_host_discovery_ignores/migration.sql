-- 트래픽 호스트 관측 · 방치 무시 · 옛 OCR 기록 귀속
-- (TASK-4301, Sprint 43 — CTO 정책 4301-①②③)

-- ── 1. 운영 트래픽에서 관측한 호스트 (정책 4301-①) ────────────────────────
--
-- 설정값(PUBLIC_BASE_URL·S3_PUBLIC_URL)만 보면 리버스 프록시 뒤의 별칭
-- 도메인이 보이지 않는다. 사용자는 그 주소로 들어오는데 우리 설정 어디에도
-- 그 이름이 없고, 검증 대상 보호는 그 주소를 "모르는 주소"로 통과시킨다.
--
-- **이 표는 관측일 뿐 허가가 아니다.** Host 헤더는 요청하는 쪽이 적는 값이며,
-- 여기에 쌓인 이름이 자동으로 PRODUCTION_HOSTS가 되는 경로는 없다 — 있으면
-- 바깥에서 우리 보호 목록에 글을 쓰는 것이 된다.
CREATE TABLE "observed_hosts" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    -- development | staging | production — 단계가 다르면 관측도 다르다
    "tier" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observed_hosts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "observed_hosts_tier_host_key" ON "observed_hosts"("tier", "host");
CREATE INDEX "observed_hosts_lastSeenAt_idx" ON "observed_hosts"("lastSeenAt");

-- ── 2. 방치 항목의 무시 결정 (정책 4301-③) ────────────────────────────────
--
-- 지금 고칠 수 없는 항목이 매일 경보를 내면 그 채널 전체가 무시되고, 그러면
-- 정작 새로 나빠진 것도 안 읽힌다. 그래서 "무시"가 필요하다 — 다만 무시는
-- 해결처럼 보이기 때문에 이 표는 조건을 함께 저장한다:
--
--   - `reviewAt`이 NULL일 수 없다. **무기한 무시는 기록이 아니라 잊는 것**이다.
--   - `owner`가 필요하다. "팀이 결정했다"는 아무도 결정하지 않은 것이다.
--   - `revokedAt`으로 취소를 남긴다 — 행을 지우면 무시했던 사실까지 사라진다.
--
-- 검토일이 지나면 판정이 무시를 자동으로 풀고 경보가 되돌아온다. 그 판정은
-- 이 표를 고치지 않는다 — 지난 결정을 다시 쓰지 않기 위해서다.
CREATE TABLE "neglect_decisions" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "reviewAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "neglect_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "neglect_decisions_tier_checkId_idx" ON "neglect_decisions"("tier", "checkId");
CREATE INDEX "neglect_decisions_reviewAt_idx" ON "neglect_decisions"("reviewAt");

-- ── 3. 옛 OCR 기록의 프로젝트 귀속 (정책 4301-②) ──────────────────────────
--
-- **이것은 추측이 아니라 조인이다.** OCR 기록은 이미지에 붙어 있고, 이미지는
-- 상품에, 상품은 프로젝트에 붙어 있다. 그 연결은 기록에 이미 있던 사실이므로
-- 여기서 채우는 값은 관측이다.
--
-- 실행 기록(executions)에는 이런 연결이 없다. 그래서 **옛 실행 기록은
-- 채우지 않는다** — 비율이나 시간대로 짐작해 채우면 그 시점부터 비용표는
-- 관측이 아니라 추정이 되고, 그 추정으로 팀에 비용을 청구하게 된다.
UPDATE "ocr_results" AS o
SET "projectId" = p."projectId"
FROM "images" AS i
JOIN "products" AS p ON p."id" = i."productId"
WHERE o."imageId" = i."id"
  AND o."projectId" IS NULL;
