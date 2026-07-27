import type { OcrProvider, OcrRecognition } from "../ocr-provider.interface";

/**
 * 테스트/개발용 Stub Provider. (OCR_PROVIDER=stub)
 * 실제 OCR 없이 결정적인 응답을 반환한다.
 */
export class StubOcrProvider implements OcrProvider {
  readonly name = "stub";

  async recognize(image: Buffer, mimeType: string): Promise<OcrRecognition> {
    return {
      text: `stub-ocr-text (${mimeType}, ${image.length} bytes)`,
      confidence: 0.99,
      raw: {
        engine: "stub",
        mimeType,
        size: image.length,
      },
    };
  }
}
