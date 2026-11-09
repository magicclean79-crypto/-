/**
 * Benchmark Product (Sprint 36, CTO 지시) — 매 기능/Prompt/Template/디자인
 * 변경마다 항상 같은 사진으로 회귀 테스트하기 위한 고정 기준.
 *
 * V1 = 2026-08-08 CTO가 지정한 "분사기 사진"(베란다용 스텐 호스 세트 3M —
 * keywords에 "물 분사기" 포함, 브랜드 삼정크린마스터). 이 imageIds는
 * 삭제·변경하지 않는다 — 새 기능을 테스트할 때마다 반드시 이 사진으로도
 * 다시 생성해 품질이 유지되는지 확인한다.
 *
 * ## 2026-08-18 — id 정정 (사진은 그대로, 주소만 바뀜)
 *
 * V1의 id 7개(`cmsirle…`)가 데이터베이스에서 **전부 사라졌습니다**(조회 0건).
 * 그 사이 데이터베이스가 한 번 초기화되며 같은 사진이 새 id로 다시 들어온
 * 것으로 보입니다(`products` 테이블도 0건). 그래서 이미지 스튜디오·벤치마크
 * 화면이 사진을 찾지 못해 비어 있었습니다.
 *
 * **사진을 바꾼 것이 아니라 주소를 고친 것입니다.** 아래 7장은 받아서 눈으로
 * 확인했고, 포장 앞면에 "베란다용 스텐 호스 세트 3M · Veranda Stainless
 * Hose Set 3M · 삼정크린마스터(주)"가 그대로 찍혀 있어 V1과 같은 상품임을
 * 확인했습니다(호스·분사기 본체·패킹·포장 앞뒤·바코드 8804161300700).
 * 따라서 "항상 같은 사진으로 회귀 테스트한다"는 규칙은 그대로 지켜집니다.
 *
 * 촬영은 KakaoTalk_20260807_1833xx 연속 7장이며, DB에서는 `kind=ORIGINAL`
 * 7건(2026-08-08)입니다.
 */
export const BENCHMARK_PRODUCT_NAME = "분사기 (베란다용 스텐 호스 세트 3M)";

export const BENCHMARK_IMAGE_IDS = [
  "cmskd3e590004ulpw8fatga47", // 분사기 본체
  "cmskd3e590006ulpwmcosfdsq", // 고무 패킹 2개
  "cmskd3e590008ulpw58jfbdkv", // 스텐 호스
  "cmskd3e59000aulpwd4qx4l9t", // 포장 앞면 (상품명)
  "cmskd3e59000culpwcshzjvyj", // 부위 명칭 · 바코드
  "cmskd3e5a000eulpwtqed80ld", // 포장 뒷면 전체
  "cmskd3e5a000gulpwu7prd9m6", // 포장 뒷면 (분사 패턴)
];

export function benchmarkVersionKey(imageIds: string[]): string {
  return [...imageIds].sort().join(",");
}

export const BENCHMARK_KEY = benchmarkVersionKey(BENCHMARK_IMAGE_IDS);
