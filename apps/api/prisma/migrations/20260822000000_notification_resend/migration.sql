-- TASK-4601, CTO 정책 4601-④: 재전송과 담당자 직접 알림.
--
-- 재시도(초 단위, 한 번의 전송 안에서)와 재전송(분·시간 단위, 전송이 끝난
-- 뒤)은 다르다. TASK-1401의 재시도는 4회 만에 포기하고 그것으로 끝이었고,
-- 슬랙이 5분 죽어 있었다면 그 사이의 경보는 영영 전달되지 않았다.
--
-- gaveUpAt을 따로 두는 이유: 조용히 그만두면 아무도 못 받은 알림이 없는
-- 일이 된다. 포기한 것도 남는다.
ALTER TABLE "notification_deliveries" ADD COLUMN "rounds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notification_deliveries" ADD COLUMN "lastResendAt" TIMESTAMP(3);
ALTER TABLE "notification_deliveries" ADD COLUMN "gaveUpAt" TIMESTAMP(3);
ALTER TABLE "notification_deliveries" ADD COLUMN "direct" BOOLEAN NOT NULL DEFAULT false;

-- 재전송 대상(실패했고 아직 포기하지 않은 것)을 고른다
CREATE INDEX "notification_deliveries_ok_gaveUpAt_createdAt_idx"
  ON "notification_deliveries"("ok", "gaveUpAt", "createdAt");
