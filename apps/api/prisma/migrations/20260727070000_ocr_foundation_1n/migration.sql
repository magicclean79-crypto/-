-- OCR Foundation Architecture (TASK-0202)
-- 데이터 보존형 마이그레이션: 컬럼/enum 값은 RENAME으로 유지한다.

-- 1) 상태 enum 값 변경: PROCESSING → RUNNING, COMPLETED → SUCCESS
ALTER TYPE "OcrStatus" RENAME VALUE 'PROCESSING' TO 'RUNNING';
ALTER TYPE "OcrStatus" RENAME VALUE 'COMPLETED' TO 'SUCCESS';

-- 2) 컬럼 이름 변경: text → extractedText, raw → rawJson
ALTER TABLE "ocr_results" RENAME COLUMN "text" TO "extractedText";
ALTER TABLE "ocr_results" RENAME COLUMN "raw" TO "rawJson";

-- 3) 실행 시작 시각 추가
ALTER TABLE "ocr_results" ADD COLUMN "startedAt" TIMESTAMP(3);

-- 4) Image 1:1 → 1:N — unique 제약을 일반 인덱스로 전환
DROP INDEX "ocr_results_imageId_key";
CREATE INDEX "ocr_results_imageId_idx" ON "ocr_results"("imageId");
