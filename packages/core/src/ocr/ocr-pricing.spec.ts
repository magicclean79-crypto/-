import {
  DEFAULT_OCR_PRICING,
  OCR_UNIT_MODEL,
  describeOcrPricing,
  estimateOcrCost,
} from "./ocr-pricing";

describe("OCR 비용 산정 (TASK-3001, CTO 결정 2901-④)", () => {
  it("운영 표준 엔진의 단가가 등록되어 있다", () => {
    // 가격표에 없으면 비용이 null이 되어 예산 계산에서 빠진다
    expect(DEFAULT_OCR_PRICING["google-vision"].perUnitUsd).toBe(0.0015);
    expect(estimateOcrCost("google-vision")).toBe(0.0015);
    expect(estimateOcrCost("google-vision", 1000)).toBe(1.5);
  });

  it("과금이 없는 엔진은 0이다 — 모르는 것과 다르다", () => {
    expect(estimateOcrCost("mock")).toBe(0);
    expect(estimateOcrCost("tesseract")).toBe(0);
  });

  it("가격표에 없는 엔진은 null이다 — 0으로 채우지 않는다", () => {
    // 0으로 채우면 예산 상한이 조용히 무력해진다
    expect(estimateOcrCost("clova")).toBeNull();
    expect(estimateOcrCost("")).toBeNull();
  });

  it("대소문자·공백을 관대하게 받는다", () => {
    expect(estimateOcrCost("  GOOGLE-VISION ")).toBe(0.0015);
  });

  it("단위 수가 이상하면 비용도 모른다", () => {
    expect(estimateOcrCost("google-vision", -1)).toBeNull();
    expect(estimateOcrCost("google-vision", Number.NaN)).toBeNull();
    // 0단위는 0원이다 (호출은 있었지만 과금 단위가 없는 경우)
    expect(estimateOcrCost("google-vision", 0)).toBe(0);
  });

  it("무료 구간을 반영하지 않는다 — 보수적으로 전액을 센다", () => {
    // 무료 구간을 빼면 예산이 실제보다 낙관적으로 보이고, 한 계정을 여러
    // 환경이 공유하면 남은 무료 구간을 우리는 알 수 없다
    expect(estimateOcrCost("google-vision", 100)).toBe(0.15);
    expect(DEFAULT_OCR_PRICING["google-vision"].note).toContain(
      "무료 구간은 반영하지 않습니다",
    );
  });

  it("비용 표에서 쓰는 모델 이름이 고정되어 있다", () => {
    // LLM 비용 문제 보고와 같은 모양을 써야 화면·경보가 갈라지지 않는다
    expect(OCR_UNIT_MODEL).toBe("text-detection");
  });

  it("가격표를 화면용으로 정렬해 돌려준다", () => {
    const rows = describeOcrPricing();
    expect(rows.map((row) => row.provider)).toEqual([
      "google-vision",
      "mock",
      "tesseract",
    ]);
    for (const row of rows) {
      expect(row.note.length).toBeGreaterThan(0);
    }
  });
});
