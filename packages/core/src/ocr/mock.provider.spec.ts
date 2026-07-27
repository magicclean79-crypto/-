import {
  MOCK_OCR_CONFIDENCE,
  MOCK_OCR_TEXT,
  MockOcrProvider,
} from "./providers/mock.provider";

describe("MockOcrProvider", () => {
  const provider = new MockOcrProvider();

  it("이름은 'mock'이다", () => {
    expect(provider.name).toBe("mock");
  });

  it("결정적인 테스트용 JSON을 반환한다", async () => {
    const result = await provider.recognize(
      new Uint8Array([1, 2, 3]),
      "image/png",
    );

    expect(result.text).toBe(MOCK_OCR_TEXT);
    expect(result.confidence).toBe(MOCK_OCR_CONFIDENCE);
    expect(result.raw).toMatchObject({
      text: "Magic Clean PVC Mat",
      confidence: 0.98,
      provider: "mock",
    });
  });

  it("raw에는 입력 메타데이터가 포함된다", async () => {
    const result = await provider.recognize(
      new Uint8Array(10),
      "image/jpeg",
    );
    expect(result.raw).toMatchObject({
      input: { mimeType: "image/jpeg", size: 10 },
    });
  });
});
