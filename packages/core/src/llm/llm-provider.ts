import type {
  LlmImageDto,
  LlmMessageDto,
  LlmResponseFormat,
} from "@acos/shared";
import type { UsageDetail } from "../execution/usage-detail";

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
    /**
     * **캐시를 뺀** 새로 청구되는 입력 토큰 (TASK-4701).
     *
     * Provider마다 이 자리에 담아 주는 값의 뜻이 다릅니다 — Anthropic은
     * 캐시를 빼고 주고, OpenAI·Gemini는 포함해서 줍니다. 어댑터가 **우리
     * 뜻으로 옮겨서** 넣습니다. 옮기지 않으면 같은 칸의 숫자가 Provider를
     * 바꿀 때마다 다른 것을 세게 됩니다.
     */
    inputTokens: number | null;
    /** **생각 토큰까지 포함한** 청구되는 출력 토큰 */
    outputTokens: number | null;
  };
  /**
   * 토큰 상세 (TASK-4701) — 캐시 읽기·쓰기·생각. 상세를 주지 않는
   * Provider는 생략하며, 그때 비용은 예전 셈 그대로입니다.
   */
  usageDetail?: UsageDetail | null;
  /** Provider 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}
