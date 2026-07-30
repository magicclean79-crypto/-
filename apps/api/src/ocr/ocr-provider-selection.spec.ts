import { MockOcrProvider } from "@acos/core";
import { KNOWN_OCR_PROVIDERS, createOcrProvider } from "./ocr.module";
import { GoogleVisionOcrProvider } from "./providers/google-vision.provider";

const GOOGLE_KEY = `AIza${"k".repeat(31)}`;

/**
 * OCR 엔진 선택. (TASK-2901, CTO 결정 2801-⑤)
 *
 * **조용히 mock으로 대체하는 것이 가장 위험한 실패다.** 이미지에서 읽지도
 * 않은 텍스트로 상품이 조립되고, 그 상품이 검수를 통과한다.
 */
describe("OCR 엔진 선택 (TASK-2901)", () => {
  it("구현된 엔진 목록이 하나의 원천이다", () => {
    expect(KNOWN_OCR_PROVIDERS).toEqual(["mock", "tesseract", "google-vision"]);
  });

  describe("알 수 없는 값", () => {
    it("운영에서는 기동을 차단한다 — mock으로 대체하지 않는다", () => {
      expect(() =>
        createOcrProvider({ NODE_ENV: "production", OCR_PROVIDER: "google" }),
      ).toThrow(/기동을 중단합니다/);
    });

    it("차단 문구가 왜 막는지 말한다", () => {
      expect(() =>
        createOcrProvider({ NODE_ENV: "production", OCR_PROVIDER: "clova" }),
      ).toThrow(/가짜 OCR로 조립된 상품은 사실이 아닙니다/);
    });

    it("개발에서는 경고 후 mock으로 간다 — 로컬을 못 뜨게 하지 않는다", () => {
      const provider = createOcrProvider({ OCR_PROVIDER: "google" });
      expect(provider).toBeInstanceOf(MockOcrProvider);
    });
  });

  describe("운영 표준 엔진", () => {
    it("키가 있으면 google-vision 어댑터를 만든다", () => {
      const provider = createOcrProvider({
        NODE_ENV: "production",
        OCR_PROVIDER: "google-vision",
        GOOGLE_VISION_API_KEY: GOOGLE_KEY,
      });
      expect(provider).toBeInstanceOf(GoogleVisionOcrProvider);
      expect(provider.name).toBe("google-vision");
    });

    it("키가 없으면 기동 시점에 실패한다", () => {
      // 첫 호출까지 기다리면 그때는 이미 이미지가 올라간 뒤다
      expect(() =>
        createOcrProvider({
          NODE_ENV: "production",
          OCR_PROVIDER: "google-vision",
        }),
      ).toThrow(/GOOGLE_VISION_API_KEY/);
    });

    it("엔드포인트·언어 힌트를 환경에서 받는다", () => {
      const provider = createOcrProvider({
        OCR_PROVIDER: "google-vision",
        GOOGLE_VISION_API_KEY: GOOGLE_KEY,
        GOOGLE_VISION_ENDPOINT: "http://127.0.0.1:9100/v1/images:annotate",
      }) as GoogleVisionOcrProvider;
      // 표시 문구에 키가 섞이지 않는다
      expect(provider.describe()).toContain("127.0.0.1:9100");
      expect(provider.describe()).not.toContain(GOOGLE_KEY);
    });
  });

  describe("mock과 개발용 엔진", () => {
    it("기본은 mock이다", () => {
      expect(createOcrProvider({})).toBeInstanceOf(MockOcrProvider);
    });

    it("운영에서 mock이어도 막지는 않는다 — 경보와 차단은 다르다", () => {
      // 막으면 OCR을 아직 붙이지 못한 환경이 아예 뜨지 못한다.
      // 대신 /ops/providers가 이 사실을 mock 상태로 보고한다.
      expect(
        createOcrProvider({ NODE_ENV: "production", OCR_PROVIDER: "mock" }),
      ).toBeInstanceOf(MockOcrProvider);
    });

    it("대소문자·공백을 관대하게 받는다", () => {
      expect(
        createOcrProvider({
          OCR_PROVIDER: "  GOOGLE-VISION ",
          GOOGLE_VISION_API_KEY: GOOGLE_KEY,
        }),
      ).toBeInstanceOf(GoogleVisionOcrProvider);
    });
  });
});
