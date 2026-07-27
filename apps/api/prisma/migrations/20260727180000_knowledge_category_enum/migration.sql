-- Knowledge.category: 자유 문자열 → Enum 고정 (CTO 결정, TASK-0401 승인 리뷰)
-- 데이터 보존: 기존 값은 대문자 변환 후 Enum과 매칭, 미매칭 값은 OTHER, NULL은 유지.

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('RULE', 'POLICY', 'GUIDE', 'BRAND', 'LEGAL', 'QUALITY', 'FAQ', 'OTHER');

-- AlterTable (기존 문자열 값을 Enum으로 변환)
ALTER TABLE "knowledge"
  ALTER COLUMN "category" TYPE "KnowledgeCategory"
  USING (
    CASE
      WHEN "category" IS NULL THEN NULL
      WHEN UPPER("category") IN ('RULE', 'POLICY', 'GUIDE', 'BRAND', 'LEGAL', 'QUALITY', 'FAQ', 'OTHER')
        THEN UPPER("category")
      ELSE 'OTHER'
    END
  )::"KnowledgeCategory";
