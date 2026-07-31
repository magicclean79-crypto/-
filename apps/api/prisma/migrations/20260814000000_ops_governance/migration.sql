-- 운영 이벤트 · 장애 사후 분석 · 감사 기록 (TASK-3801, Sprint 38 — 정책 3801-①②④)
--
-- 표 둘을 새로 만들고 `incidents`에 nullable 컬럼 다섯을 더한다. 파괴적
-- 변경이 없고 재해 복구 절차를 바꾸지 않으므로 Major Migration이 아니다
-- (결정 1901-① 기준).
--
-- 1. ops_events — 시스템이 관측한 **상태 변화**. 활성화가 완료되는 순간은
--    대개 아무도 화면을 보고 있지 않을 때 온다. 그 순간을 아무도 모르면
--    운영은 이미 켤 수 있게 된 상태로 며칠을 더 논다. `key`가 같은 전이를
--    두 번 알리지 않게 막는다.
--
-- 2. ops_audit_log — 사람이 **한 일**. 이벤트와 한 표에 섞지 않는 이유는
--    "누가 했나"와 "무엇이 일어났나"를 다시 손으로 갈라야 하기 때문이다.
--    **실패한 시도도 남긴다** — 성공만 남는 기록으로는 "그 시각에 누가
--    무엇을 눌렀는가"에 답할 수 없다.
--
-- 3. incidents.fixKind/rootCause/temporaryFix/permanentFix/prevention —
--    재시작으로 살린 것과 원인을 없앤 것이 목록에서 똑같이 "복구됨"으로
--    보이면, 팀은 자기가 몇 개의 시한폭탄을 안고 있는지 모른다.
--    옛 기록은 전부 null이며 null은 "영구 조치였다"가 아니라 "모른다"다.

CREATE TABLE "ops_events" (
    "id" TEXT NOT NULL,
    -- activation-completed | activation-lost
    "kind" TEXT NOT NULL,
    -- 같은 전이를 두 번 알리지 않기 위한 키
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    -- 급한 소식인가 (풀린 것은 급하다)
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL,
    -- 알림 채널로 내보낸 시각 — 못 보냈으면 null(보냈다고 적지 않는다)
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_events_pkey" PRIMARY KEY ("id")
);

-- 같은 전이는 한 번만 — 애플리케이션이 아니라 표가 막는다
CREATE UNIQUE INDEX "ops_events_key_key" ON "ops_events" ("key");
CREATE INDEX "ops_events_createdAt_idx" ON "ops_events" ("createdAt");

CREATE TABLE "ops_audit_log" (
    "id" TEXT NOT NULL,
    -- smoke.run | incident.resolve | backup.run …  (URL이 바뀌어도 유지되는 이름)
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    -- 대상 식별자 (장애 id 등) — 없으면 null
    "target" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    -- ok | failed — **실패한 시도도 남긴다**
    "outcome" TEXT NOT NULL,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    -- 본문 요약: 값이 아니라 **이름**만 (자격 증명이 새면 안 된다)
    "detail" TEXT,
    "requestId" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ops_audit_log_createdAt_idx" ON "ops_audit_log" ("createdAt");
CREATE INDEX "ops_audit_log_action_createdAt_idx" ON "ops_audit_log" ("action", "createdAt");
CREATE INDEX "ops_audit_log_actorId_createdAt_idx" ON "ops_audit_log" ("actorId", "createdAt");

-- 장애 사후 분석 (CTO 정책 3801-②)
ALTER TABLE "incidents" ADD COLUMN "fixKind" TEXT;
ALTER TABLE "incidents" ADD COLUMN "rootCause" TEXT;
ALTER TABLE "incidents" ADD COLUMN "temporaryFix" TEXT;
ALTER TABLE "incidents" ADD COLUMN "permanentFix" TEXT;
ALTER TABLE "incidents" ADD COLUMN "prevention" TEXT;

-- 영구 조치를 기다리는 장애를 찾는 조회를 받쳐 준다
CREATE INDEX "incidents_fixKind_resolvedAt_idx" ON "incidents" ("fixKind", "resolvedAt");
