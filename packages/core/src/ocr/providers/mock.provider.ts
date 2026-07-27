import type { OcrProvider, OcrRecognition } from "../ocr-provider";

export const MOCK_OCR_TEXT = "Magic Clean PVC Mat";
export const MOCK_OCR_CONFIDENCE = 0.98;

/**
 * Mock OCR Provider.
 *
 * 실제 OCR API를 연결하기 전까지 사용하는 기본 Provider로,
 * 결정적인 테스트용 JSON을 반환한다.
 */
export class MockOcrProvider implements OcrProvider {
  readonly name = "mock";

  async recognize(
    image: Uint8Array,
    mimeType: string,
  ): Promise<OcrRecognition> {
    return {
      text: MOCK_OCR_TEXT,
      confidence: MOCK_OCR_CONFIDENCE,
      raw: {
        text: MOCK_OCR_TEXT,
        confidence: MOCK_OCR_CONFIDENCE,
        provider: this.name,
        input: { mimeType, size: image.byteLength },
      },
    };
  }
}
