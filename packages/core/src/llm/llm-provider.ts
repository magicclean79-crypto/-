import type {
  LlmImageDto,
  LlmMessageDto,
  LlmResponseFormat,
} from "@acos/shared";

/**
 * LLM Provider 추상화 (Port). (TASK-0501, Sprint 5 — AI Execution)
 *
 * OpenAI / Anthropic / Google Gemini 등 실제 모델은 이 인터페이스를 구현해
 * 교체한다 (어댑터는 apps/api/src/llm/providers/). 기본은 MockLlmProvider —
 * API 키가 설정된 경우에만 실제 Provider가 선택된다.
 * 자세한 구조: docs/architecture/llm.md
 */
export interface LlmProvider {
  /** Provider 식별자 (예: "mock", "openai", "anthropic", "gemini") */
  readonly name: string;
  /** 기본 모델 ID — 요청에서 model 미지정 시 사용 */
  readonly defaultModel: string;

  complete(request: LlmRequest): Promise<LlmResult>;
}

export interface LlmRequest {
  messages: LlmMessageDto[];
  /** Provider 기본 모델을 덮어쓸 모델 ID */
  model?: string;
  /** 최대 출력 토큰 */
  maxTokens?: number;
  /**
   * 기대 응답 형식 (기본 "text"). "json"이면 Provider는 JSON 객체 하나만
   * 출력해야 한다 — 프롬프트 지침이 1차 강제이며, Provider별 구조화 출력
   * 옵션(예: OpenAI response_format)은 어댑터에서 선택적으로 매핑한다.
   */
  responseFormat?: LlmResponseFormat;
  /**
   * 첨부 이미지 (멀티모달 — TASK-0505). 어댑터가 Provider별 이미지 입력
   * 형식(content block/image_url/inlineData)으로 매핑해 마지막 user 메시지에
   * 붙인다. mock은 이미지를 읽지 않고 개수만 raw에 기록한다.
   */
  images?: LlmImageDto[];
}

export interface LlmResult {
  provider: string;
  model: string;
  text: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  /** Provider 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}
