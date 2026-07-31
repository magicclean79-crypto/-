-- 장애 초안 (TASK-3901, Sprint 39 — CTO 정책 3901-⑤)
--
-- 경보에서 자동으로 만드는 것은 **초안**이지 장애가 아니다. 초안은 "이건
-- 장애였을 수 있습니다, 봐 주세요"라는 질문이고, 사람이 확인하면 장애가
-- 되고 기각하면 사유와 함께 남는다.
--
-- 기존 행은 전부 CONFIRMED다 — 지금까지의 장애는 모두 사람이 열었다.
-- 기본값을 DRAFT로 두면 옛 장애가 전부 "확인 대기"가 되어 목록이 거짓말한다.
--
-- 파괴적 변경이 없고 재해 복구 절차를 바꾸지 않으므로 Major Migration이
-- 아니다 (결정 1901-① 기준).

-- DRAFT | CONFIRMED | DISMISSED
ALTER TABLE "incidents" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'CONFIRMED';
-- 어느 경보에서 왔는가 — 같은 경보로 초안을 두 번 만들지 않기 위한 키
ALTER TABLE "incidents" ADD COLUMN "sourceAlertKey" TEXT;
ALTER TABLE "incidents" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "incidents" ADD COLUMN "dismissReason" TEXT;
ALTER TABLE "incidents" ADD COLUMN "dismissedById" TEXT;

-- 같은 경보로 초안이 둘 생기는 것을 **표가** 막는다. 애플리케이션 로직만
-- 으로는 두 인스턴스가 동시에 승격할 때 둘 다 통과한다.
CREATE UNIQUE INDEX "incidents_sourceAlertKey_key" ON "incidents" ("sourceAlertKey")
  WHERE "sourceAlertKey" IS NOT NULL;

-- 확인 대기 초안을 먼저 찾는 조회
CREATE INDEX "incidents_status_startedAt_idx" ON "incidents" ("status", "startedAt");
