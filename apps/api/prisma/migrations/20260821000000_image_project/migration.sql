-- TASK-4501, CTO 정책 4501-②: 업로드 단계부터 projectId를 받는다.
--
-- 상품에 붙기 전의 이미지는 상품을 통해 프로젝트에 닿을 길이 없다. 그
-- 상태로 돌린 OCR 호출의 비용은 나중에 상품을 붙여도 **소급되지 않는다** —
-- 기록은 실행 시점의 사실이기 때문이다. 그래서 소속을 받는 자리를 앞으로
-- 옮긴다.
--
-- 기존 행은 NULL로 남는다. 여기서 상품 조인으로 채우지 않는 이유는, 그렇게
-- 채운 값이 "업로드한 사람이 밝힌 소속"이 아니라 **우리가 나중에 추측한
-- 값**이기 때문이다. 조인으로 알 수 있는 것은 지금도 조인으로 읽는다.
ALTER TABLE "images" ADD COLUMN "projectId" TEXT;

CREATE INDEX "images_projectId_idx" ON "images"("projectId");

ALTER TABLE "images"
  ADD CONSTRAINT "images_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
