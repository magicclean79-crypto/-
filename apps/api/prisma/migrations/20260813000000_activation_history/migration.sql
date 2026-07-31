-- 운영 활성화 이력 · 스모크 · 장애 이력 (TASK-3701, Sprint 37 — CTO 정책 3701-①②④)
--
-- 표 셋을 새로 만들고 기존 표는 건드리지 않는다. 파괴적 변경이 없고 재해
-- 복구 절차를 바꾸지 않으므로 Major Migration이 아니다 (결정 1901-① 기준).
--
-- 1. activation_events — 활성화 **과정**을 시간순으로. 화면을 열 때마다 한
--    줄씩 쌓으면 같은 문장 수천 줄이 되고 그 안에서 변화가 안 보인다. 그래서
--    상태가 바뀔 때만 새 줄을 만들고, 같은 상태를 다시 보면 lastSeenAt만
--    갱신한다. **lastSeenAt이 있어야 "3주째 그대로"와 "3주 동안 아무도 안
--    봤다"를 가를 수 있다.**
--
-- 2. smoke_runs — 실 Provider를 **실제로 불러 본** 결과. 형식·도달·기록이
--    다 통과해도 "지금 부르면 되는가"에는 답하지 못한다. 상대 주소를 함께
--    적는다: 스텁을 상대로 받은 200은 통과가 아니기 때문이다.
--
-- 3. incidents — 사람이 여는 장애 기록. 경보(alerts)는 신호이고 장애는 선언된
--    사건이다. resolvedAt이 null이면 진행 중이며, 그 지속 시간은 최종값이
--    아니라 "지금까지"다. 복구 방법(recovery) 없이는 닫지 않는다.

CREATE TABLE "activation_events" (
    "id" TEXT NOT NULL,
    -- 상태 지문 — 같으면 같은 구간으로 본다 (activated + 충족 조건 집합)
    "signature" TEXT NOT NULL,
    "activated" BOOLEAN NOT NULL,
    -- 그때 충족돼 있던 조건 (credentials · network · cutover)
    "met" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    -- 이 상태가 처음 관측된 시각 / 마지막으로 관측된 시각 / 관측 횟수
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observations" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "activation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activation_events_recordedAt_idx" ON "activation_events" ("recordedAt");

CREATE TABLE "smoke_runs" (
    "id" TEXT NOT NULL,
    -- llm | ocr | storage
    "target" TEXT NOT NULL,
    -- passed | failed | stubbed | skipped
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    -- 실제로 부른 주소의 기준점 — 모르면 null. null은 "공식이었다"가 아니다
    "baseUrl" TEXT,
    "latencyMs" INTEGER,
    "detail" TEXT NOT NULL,
    -- 누가 눌렀는가 — 실 호출은 돈이 나가므로 책임자가 남아야 한다
    "actorId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smoke_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "smoke_runs_target_createdAt_idx" ON "smoke_runs" ("target", "createdAt");

CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    -- llm | ocr | storage | database | queue | web | api | other
    "component" TEXT NOT NULL,
    -- MINOR | MAJOR | CRITICAL
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    -- 장애가 시작된 시각 (우리가 알아챈 시각이 아니다)
    "startedAt" TIMESTAMP(3) NOT NULL,
    -- 우리가 알아챈 시각 — 모르면 null. 이 간격이 크면 고칠 곳은 감시다
    "detectedAt" TIMESTAMP(3),
    -- 복구 시각 — null이면 진행 중
    "resolvedAt" TIMESTAMP(3),
    "cause" TEXT,
    "recovery" TEXT,
    "openedById" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- 진행 중인 장애를 먼저 찾는 조회 · 기간별 조회를 받쳐 준다
CREATE INDEX "incidents_resolvedAt_startedAt_idx" ON "incidents" ("resolvedAt", "startedAt");
CREATE INDEX "incidents_component_startedAt_idx" ON "incidents" ("component", "startedAt");
