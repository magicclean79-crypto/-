-- Memory.scope: 자유 문자열 → Enum 고정 (CTO 결정, TASK-0402 승인 리뷰)
-- 데이터 보존: 기존 값은 대문자 변환 후 Enum과 매칭, 미매칭 값은 GLOBAL로 이관.

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('GLOBAL', 'COMPANY', 'PROJECT', 'PRODUCT');

-- AlterTable (기존 문자열 값을 Enum으로 변환)
ALTER TABLE "memories"
  ALTER COLUMN "scope" TYPE "MemoryScope"
  USING (
    CASE
      WHEN UPPER("scope") IN ('GLOBAL', 'COMPANY', 'PROJECT', 'PRODUCT')
        THEN UPPER("scope")
      ELSE 'GLOBAL'
    END
  )::"MemoryScope";
