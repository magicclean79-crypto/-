-- Product Detail Engine LEVEL 2 실제 상세페이지 조립 (T1-195)
-- verifiedProductFacts의 근거(provenance) — 분석 호출에 실제로 전달된
-- Level1Asset id 전체를 기록한다. 기존 컬럼은 건드리지 않는다.

ALTER TABLE "level1_multi_generations" ADD COLUMN "analysisAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
