import {
  canTransitionProductObject,
  PRODUCT_OBJECT_TRANSITIONS,
  validateReadyRequirements,
} from "./product-object.status";

describe("Product Object 상태 전이 (Unit Test)", () => {
  it("허용 전이: DRAFT⇄READY, DRAFT/READY→ARCHIVED", () => {
    expect(canTransitionProductObject("DRAFT", "READY")).toBe(true);
    expect(canTransitionProductObject("DRAFT", "ARCHIVED")).toBe(true);
    expect(canTransitionProductObject("READY", "DRAFT")).toBe(true);
    expect(canTransitionProductObject("READY", "ARCHIVED")).toBe(true);
  });

  it("금지 전이: ARCHIVED는 종결 상태, 동일 상태 전이 불가", () => {
    expect(canTransitionProductObject("ARCHIVED", "DRAFT")).toBe(false);
    expect(canTransitionProductObject("ARCHIVED", "READY")).toBe(false);
    expect(canTransitionProductObject("DRAFT", "DRAFT")).toBe(false);
    expect(PRODUCT_OBJECT_TRANSITIONS.ARCHIVED).toEqual([]);
  });

  it("READY 필수 조건: 제목 + (OCR 또는 Vision 요약)", () => {
    expect(
      validateReadyRequirements({
        title: "제목",
        ocrSummary: { combinedText: "x" },
        visionSummary: null,
      }),
    ).toEqual([]);

    expect(
      validateReadyRequirements({
        title: "제목",
        ocrSummary: null,
        visionSummary: { source: "mock" },
      }),
    ).toEqual([]);

    const errors = validateReadyRequirements({
      title: "   ",
      ocrSummary: null,
      visionSummary: null,
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("제목");
  });
});
