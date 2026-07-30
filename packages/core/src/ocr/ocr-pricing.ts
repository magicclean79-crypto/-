/**
 * OCR 비용 산정. (TASK-3001, Sprint 30 — CTO 결정 2901-④)
 *
 * OCR도 **호출당 과금되는 AI 호출**입니다. 그런데 지금까지 OCR 비용은
 * 어디에도 기록되지 않았습니다 — 예산 상한은 LLM 지출만 보고 있었고,
 * OCR을 실 엔진(Google Cloud Vision)으로 붙인 순간부터 **예산 밖에서 돈이
 * 나가는 경로**가 생겼습니다. 결정 2901-④는 그것을 LLM과 같은 취급으로
 * 편입하라는 것입니다.
 *
 * LLM 가격표(`DEFAULT_LLM_PRICING`)와 같은 결로 둡니다:
 * **코드 선언 중앙 정의**이고, 표에 없는 Provider는 `null`(미산정)입니다 —
 * 0으로 채우면 **예산 상한이 조용히 무력화**됩니다(비용이 0인 것과 모르는
 * 것은 다릅니다).
 *
 * **무료 구간은 반영하지 않습니다.** Google Cloud Vision은 월 1,000 단위까지
 * 무료지만, 그것을 빼고 세면 두 가지가 어긋납니다:
 * - 예산이 실제보다 **낙관적으로** 보입니다.
 * - 한 계정을 여러 환경이 공유하면 무료 구간이 이미 소진됐는지 **우리는 알
 *   수 없습니다** — 모르는 것을 유리하게 가정하지 않습니다.
 *
 * 보수적으로 전액을 세고, 그 사실을 문구로 밝힙니다.
 */

/** OCR 호출 1단위(이미지 1장 · 검사 1종)의 단가 */
export interface OcrUnitPrice {
  perUnitUsd: number;
  /** 단가의 출처·범위 (표시용) */
  note: string;
}

/**
 * 비용 표에서 OCR이 쓰는 "모델" 자리.
 *
 * LLM 비용 문제 보고(`CostIssue.model`)와 같은 모양을 쓰기 위한 이름입니다 —
 * OCR은 모델을 고르지 않지만, 두 계층이 다른 모양을 쓰면 화면과 경보가
 * 갈라집니다.
 */
export const OCR_UNIT_MODEL = "text-detection";

/** Provider별 OCR 단가 — 표에 없으면 미산정(null) */
export const DEFAULT_OCR_PRICING: Record<string, OcrUnitPrice> = {
  // 가짜는 호출하지 않는다
  mock: { perUnitUsd: 0, note: "가짜 엔진 — 외부 호출이 없어 과금 0" },
  // 로컬 WASM — 외부 과금은 없다(CPU는 서버 비용이고 호출당 과금이 아니다)
  tesseract: {
    perUnitUsd: 0,
    note: "로컬 WASM 엔진 — 호출당 과금 없음 (서버 CPU 비용은 별개)",
  },
  // Google Cloud Vision TEXT_DETECTION 공개 단가 (USD / 1,000 단위)
  "google-vision": {
    perUnitUsd: 0.0015,
    note: "TEXT_DETECTION 1,000단위당 $1.50 (공개 단가) — 무료 구간은 반영하지 않습니다",
  },
};

/**
 * OCR 호출 비용 (USD) — 표에 없는 Provider는 `null`.
 *
 * `null`은 "공짜"가 아니라 **"모른다"**입니다. 예산 계산에서 빠지므로
 * 운영에서 가장 위험한 상태이고, 그래서 미산정 경보의 대상이 됩니다
 * (LLM의 `unpriced-model`과 같은 취급).
 */
export function estimateOcrCost(
  provider: string,
  units = 1,
  pricing: Record<string, OcrUnitPrice> = DEFAULT_OCR_PRICING,
): number | null {
  const price = pricing[provider.trim().toLowerCase()];
  if (!price) {
    return null;
  }
  if (!Number.isFinite(units) || units < 0) {
    return null; // 단위를 모르면 비용도 모른다
  }
  return Number((price.perUnitUsd * units).toFixed(6));
}

/** 가격표를 화면에 보여줄 형태로 */
export function describeOcrPricing(
  pricing: Record<string, OcrUnitPrice> = DEFAULT_OCR_PRICING,
): { provider: string; perUnitUsd: number; note: string }[] {
  return Object.entries(pricing)
    .map(([provider, price]) => ({ provider, ...price }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
