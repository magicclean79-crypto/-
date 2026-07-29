-- Requirement 취소 (TASK-2001, Sprint 20 — CTO 결정 1901-②)
--
-- 삭제는 금지한다. 잘못 등록한 요구도 기록으로 남아야 하고, 왜 취소했는지가
-- 다음 판단의 근거가 된다.

ALTER TABLE "drill_requirements" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "drill_requirements" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "drill_requirements" ADD COLUMN "cancelReason" TEXT;
