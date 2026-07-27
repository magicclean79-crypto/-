-- decisionType: 자유 문자열 → Enum 고정 (CTO 결정, TASK-0306 승인 리뷰)
-- 데이터 보존: 기존 값은 대문자 변환 후 Enum과 매칭, 매칭 실패는 OTHER로 이관.

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('ARCHITECTURE', 'PROCESS', 'PRODUCT', 'BUSINESS', 'TECHNICAL', 'QUALITY', 'SECURITY', 'OTHER');

-- AlterTable (기존 문자열 값을 Enum으로 변환)
ALTER TABLE "decisions"
  ALTER COLUMN "decisionType" TYPE "DecisionType"
  USING (
    CASE
      WHEN UPPER("decisionType") IN ('ARCHITECTURE', 'PROCESS', 'PRODUCT', 'BUSINESS', 'TECHNICAL', 'QUALITY', 'SECURITY', 'OTHER')
        THEN UPPER("decisionType")
      ELSE 'OTHER'
    END
  )::"DecisionType";
