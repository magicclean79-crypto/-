import type { VisionSummary } from "@acos/shared";

/**
 * Vision Provider 추상화 (Port).
 *
 * Claude Vision, Google Vision, GPT-4V 등 어떤 모델이든 이 인터페이스만
 * 구현하면 교체할 수 있다. Product Object 조립 시 visionSummary를 공급한다.
 * 자세한 구조: docs/architecture/vision.md
 */
export interface VisionProvider {
  /** Provider 식별자. VisionSummary.source에 반영된다. */
  readonly name: string;

  /**
   * 상품 이미지들을 분석해 VisionSummary로 정규화한다.
   * 실패 시 reject — 재시도/폴백은 호출자(ProductObjectService)가 담당한다.
   */
  analyze(input: VisionInput): Promise<VisionRecognition>;
}

export interface VisionInput {
  project: {
    id: string;
    name: string;
    description: string | null;
  };
  images: VisionImageInput[];
  /** 참고용 OCR 텍스트 (있으면 정확도 향상에 사용) */
  ocrTexts: string[];
}

export interface VisionImageInput {
  id: string;
  mimeType: string;
  /** 원본 바이트 로더 — 필요할 때만 호출한다 (mock은 읽지 않음) */
  getBytes(): Promise<Uint8Array>;
}

export interface VisionRecognition {
  summary: VisionSummary;
  /** Provider 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}
