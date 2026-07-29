-- TASK-1401 Production Operations Platform (Sprint 14)

-- CTO 결정 1302-④: 경보는 삭제하지 않는다. 해소 후 유예가 지나면 보관한다.
ALTER TYPE "AlertStatus" ADD VALUE 'ARCHIVED';

ALTER TABLE "alerts" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "alerts_kind_lastRaisedAt_idx" ON "alerts"("kind", "lastRaisedAt");

-- 알림 전송 시도 이력 — "왜 아무도 못 받았는가"를 추적한다
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "status" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_deliveries_alertKey_createdAt_idx" ON "notification_deliveries"("alertKey", "createdAt");
CREATE INDEX "notification_deliveries_channel_createdAt_idx" ON "notification_deliveries"("channel", "createdAt");
