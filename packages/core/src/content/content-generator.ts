import type { OcrSummary, VisionSummary } from "@acos/shared";

/**
 * 상세페이지 콘텐츠 생성기 추상화 (Port). (TASK-0303)
 *
 * @deprecated CTO 결정(TASK-0502 승인): 공식 생성 엔진은 Content Generation
 * Engine(READY PO + Company Brain + LLM Gateway)이다. 이 Port 경로는
 * 다음 Sprint에서 내부적으로 새 엔진을 호출하도록 통합될 예정.
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
