import type { OcrSummary, VisionSummary } from "@acos/shared";

/**
 * 상세페이지 콘텐츠 생성기 추상화 (Port). (TASK-0303)
 *
 * Product Object를 단일 입력으로 받아 상세페이지 콘텐츠를 생성한다.
 * Claude, OpenAI 등 실제 모델은 이 인터페이스를 구현해 교체한다.
 * 자세한 구조: docs/architecture/content.md
 */
export interface ContentGenerator {
  /** Generator 식별자 */
  readonly name: string;

  generate(input: ContentGenerationInput): Promise<ContentGenerationResult>;
}

/** 생성 입력 — Product Object가 단일 진실 공급원이다 */
export interface ContentGenerationInput {
  project: {
    id: string;
    name: string;
    description: string | null;
  };
  productObject: {
    id: string;
    version: number;
    title: string;
    brand: string | null;
    category: string | null;
    attributes: Record<string, string>;
    ocrSummary: OcrSummary | null;
    visionSummary: VisionSummary | null;
  };
}

export interface ContentGenerationResult {
  title: string;
  /** 상세페이지 본문 (Markdown) */
  body: string;
  /** Generator 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}
