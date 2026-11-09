/**
 * 이미지 생성/편집 Provider 추상화 (Port). (Sprint 36 — CTO 지시: Gemini는
 * 디자인 심사가 아니라 이미지 생성/편집 담당 — 배경 제거, 배경 생성, 제품
 * 합성, Hero 이미지 생성.)
 *
 * `LlmProvider`(packages/core/src/llm/llm-provider.ts)와 의도적으로 분리한다
 * — 텍스트 LLM은 결과가 `text: string`이지만 이 Port는 결과가 이미지
 * 바이트다. 두 계약을 하나로 억지로 합치면 미사용 필드가 늘어난다.
 *
 * 실측 확인(2026-08-08, staging에서 `@google/genai`의
 * `generateContent({ config: { responseModalities: [Modality.IMAGE] } })`로
 * 직접 호출): 배경 제거·배경 생성·제품 합성 3가지 모두 같은 메서드 하나로
 * 처리된다 — 입력 이미지 개수(0/1/2장)와 프롬프트만 다르다. 그래서 이 Port도
 * 메서드 하나(`edit`)로 세 가지 용도를 전부 표현한다.
 */
export interface ImageEditProvider {
  /** Provider 식별자 (예: "mock", "gemini") */
  readonly name: string;
  /** 기본 모델 ID */
  readonly defaultModel: string;

  edit(request: ImageEditRequest): Promise<ImageEditResult>;
}

export interface ImageEditRequest {
  /** 무엇을 만들지/어떻게 편집할지 지시하는 프롬프트 */
  prompt: string;
  /**
   * 입력 이미지 0~N장.
   * - 0장: 순수 텍스트→이미지 생성(예: "배경만 생성해줘")
   * - 1장: 이미지 편집(예: "이 사진에서 배경을 제거해줘")
   * - 2장 이상: 합성(예: "첫 번째 이미지를 두 번째 이미지 위에 합성해줘")
   */
  images?: { mimeType: string; base64: string }[];
  /** Provider 기본 모델을 덮어쓸 모델 ID */
  model?: string;
  /**
   * 생성 품질 힌트 (T1-152) — 미지정 시 Provider 기본값(OpenAI는 "high").
   * 주 상품 사진(Hero/사용 장면/후보 이미지)은 항상 기본값(high)을 쓴다.
   * Product Story의 보조 그래픽·아이콘·Hero 모티프처럼 장식용이고 여러 장을
   * 순차 호출하는 경로만 "low"를 지정한다 — GPT Image 2가 quality:"high"에서
   * 장당 약 100초 이상 걸려(2026-08-18 실측), 그런 경로를 그대로 두면
   * 여러 장 합계가 수 분을 넘겨 요청 자체가 응답 없이 멈춘 것처럼 보인다.
   * Gemini/Mock Provider는 이 값을 무시해도 된다(품질 손잡이가 없음).
   */
  quality?: "low" | "medium" | "high";
}

export interface ImageEditResult {
  provider: string;
  model: string;
  /** 생성/편집된 이미지 바이트 (base64) */
  imageBytes: string;
  mimeType: string;
  /** Provider가 이미지와 함께 텍스트도 반환하면(예: 거부 이유) 여기 담는다 */
  text: string | null;
  /** Provider 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}

export class ImageEditError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = "ImageEditError";
  }
}
