import type { AnalysisStatus, ProductAnalysis } from "@acos/shared";

/**
 * AI 분석 Provider 추상화 (Port).
 *
 * Claude, OpenAI, Gemini 등 어떤 모델이든 이 인터페이스만 구현하면
 * 교체할 수 있다. 구현체(Adapter)는 apps/api에 둔다.
 * 자세한 구조: docs/architecture/analysis.md
 */
export interface AnalysisProvider {
  /** Provider 식별자. AnalysisResult.provider에 그대로 저장된다. */
  readonly name: string;

  /**
   * 상품 이미지와 OCR 텍스트로부터 구조화된 상품 정보를 추출한다.
   * 실패 시 reject — 재시도/상태 관리는 AnalysisExecutionService가 담당한다.
   */
  analyze(input: AnalysisInput): Promise<AnalysisRecognition>;
}

export interface AnalysisInput {
  product: {
    id: string;
    name: string;
    description: string | null;
  };
  images: AnalysisImageInput[];
  /** 각 이미지의 최신 OCR 성공 텍스트 (없는 이미지는 제외) */
  ocrTexts: string[];
}

export interface AnalysisImageInput {
  id: string;
  mimeType: string;
  /** Vision 모델용 원본 바이트 로더 — 필요할 때만 호출한다 */
  getBytes(): Promise<Uint8Array>;
}

export interface AnalysisRecognition {
  analysis: ProductAnalysis;
  /** Provider 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}

/** Analysis Domain 모델 — 저장소와 무관한 순수 표현 */
export interface AnalysisRun {
  id: string;
  productId: string;
  provider: string;
  status: AnalysisStatus;
  result: ProductAnalysis | null;
  rawJson: unknown;
  error: string | null;
  attempts: number;
  applied: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** 분석 실행 기록 저장소 (Port) — Product당 실행 이력 1:N */
export interface AnalysisRunStore {
  start(productId: string, provider: string): Promise<AnalysisRun>;
  markSuccess(
    id: string,
    recognition: AnalysisRecognition,
    attempts: number,
  ): Promise<AnalysisRun>;
  markFailed(id: string, error: string, attempts: number): Promise<AnalysisRun>;
}
