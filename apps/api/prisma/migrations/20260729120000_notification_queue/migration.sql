-- TASK-1501 High Availability & Operations Reliability (Sprint 15)

-- CTO 결정 1401-②: Persistent Notification Queue (Retry Worker + Dead Letter Queue).
-- TASK-1401의 재시도는 프로세스 안에서만 돌아 재시작 시 사라졌다.
CREATE TYPE "NotificationQueueStatus" AS ENUM ('PENDING', 'SENT', 'DEAD');

CREATE TABLE "notification_queue" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationQueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_queue_status_nextAttemptAt_idx" ON "notification_queue"("status", "nextAttemptAt");
CREATE INDEX "notification_queue_alertKey_createdAt_idx" ON "notification_queue"("alertKey", "createdAt");
