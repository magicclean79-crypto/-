/**
 * Benchmark Product (Sprint 36, CTO 지시) — 매 기능/Prompt/Template/디자인
 * 변경마다 항상 같은 사진으로 회귀 테스트하기 위한 고정 기준.
 *
 * V1 = 2026-08-08 CTO가 지정한 "분사기 사진"(베란다용 스텐 호스 세트 3M —
 * keywords에 "물 분사기" 포함, 브랜드 삼정크린마스터). 이 imageIds는
 * 삭제·변경하지 않는다 — 새 기능을 테스트할 때마다 반드시 이 사진으로도
 * 다시 생성해 품질이 유지되는지 확인한다.
 */
export const BENCHMARK_PRODUCT_NAME = "분사기 (베란다용 스텐 호스 세트 3M)";

export const BENCHMARK_IMAGE_IDS = [
  "cmsirlexg003s4544yjd0umx2",
  "cmsirlevo003o45440fovddc5",
  "cmsirlev8003m45444at2xo77",
  "cmsirleu4003i4544jii0dypx",
  "cmsirleu7003k4544phreh19k",
  "cmsirlewa003q4544hfodjmxx",
  "cmsirlet4003g4544ybz1l9rl",
];

export function benchmarkVersionKey(imageIds: string[]): string {
  return [...imageIds].sort().join(",");
}

export const BENCHMARK_KEY = benchmarkVersionKey(BENCHMARK_IMAGE_IDS);
