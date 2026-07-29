-- Enterprise Backup & Disaster Recovery (TASK-1701, Sprint 17)
--
-- 덤프가 "있다"와 "온전하다"는 다르다. 무결성 판독 결과와 체크섬을 남겨,
-- 읽히지 않는 덤프를 복원 시점이 아니라 백업 직후에 알아차린다.
-- 원격 복제 키를 남기는 이유는 호스트가 사라져도 어디서 받을지 알기 위해서다.

ALTER TABLE "backup_runs" ADD COLUMN "checksum" TEXT;
ALTER TABLE "backup_runs" ADD COLUMN "integrityOk" BOOLEAN;
ALTER TABLE "backup_runs" ADD COLUMN "entries" INTEGER;
ALTER TABLE "backup_runs" ADD COLUMN "offsiteKey" TEXT;
