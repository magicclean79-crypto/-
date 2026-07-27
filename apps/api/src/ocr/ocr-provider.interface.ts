/**
 * OCR Provider 추상화.
 *
 * 새 Provider(Google Vision, CLOVA OCR 등)는 이 인터페이스를 구현한 뒤
 * ocr.module.ts의 팩토리에 등록하고 OCR_PROVIDER 환경 변수로 선택한다.
 */
export interface OcrRecognition {
  /** 추출된 전체 텍스트 */
  text: string;
  /** 신뢰도 0.0 ~ 1.0 */
  confidence: number;
  /** Provider가 반환한 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}

export interface OcrProvider {
  readonly name: string;
  recognize(image: Buffer, mimeType: string): Promise<OcrRecognition>;
}

export const OCR_PROVIDER = Symbol("OCR_PROVIDER");
