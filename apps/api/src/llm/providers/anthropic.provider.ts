import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmRequest, LlmResult } from "@acos/core";

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MAX_TOKENS = 1024;

/** 테스트에서 대체 가능한 최소 클라이언트 표면 (messages.create) */
export interface AnthropicMessagesClient {
  messages: {
    create: (
      params: Anthropic.MessageCreateParamsNonStreaming,
    ) => Promise<Anthropic.Message>;
  };
}

/**
 * Anthropic(Claude) 어댑터 — 공식 @anthropic-ai/sdk 사용.
 * (TASK-0501 · 공식 연결 TASK-0903)
 * ANTHROPIC_API_KEY가 설정된 경우에만 LLM_PROVIDER=anthropic으로 선택된다.
 *
 * TASK-0903에서 활성화된 것:
 * - responseFormat "json" → **JSON 전용 system 지시 강화**로 매핑.
 *   Claude 4.6+ 모델은 assistant prefill이 400이므로 prefill 방식을 쓰지
 *   않는다. 스키마 없는 자유 JSON에는 지시 + 엄격 파싱(재시도)이 공식 매핑
 * - 잘림 방어: stop_reason "max_tokens" + JSON → 명확한 오류 (Execution
 *   FAILED — OpenAI 어댑터와 동일 정책, CTO 확정 0901-②)
 * - Execution Cost: claude-opus-5 계열 단가가 가격표에 등록됨 (@acos/core)
 * - 테스트용 클라이언트 주입 지원
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  private readonly client: AnthropicMessagesClient;

  constructor(options: {
    apiKey: string;
    model?: string;
    /** 테스트 전용 — 미지정 시 공식 SDK 클라이언트 생성 */
    client?: AnthropicMessagesClient;
  }) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    // Anthropic API는 system을 별도 파라미터로 받는다
    const systemParts = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    // 구조화 출력 (TASK-0903): 스키마 없는 JSON은 system 지시로 강제
    // (Claude 4.6+는 assistant prefill 400 — 지시 + 엄격 파싱이 공식 매핑)
    if (request.responseFormat === "json") {
      systemParts.push(
        "출력 형식 강제: 응답은 유효한 JSON 객체 하나여야 한다. " +
          "코드 펜스·머리말·해설 등 JSON 외 텍스트를 포함하지 마라.",
      );
    }
    const system = systemParts.join("\n");
    const messages: Anthropic.MessageParam[] = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }));

    // 첨부 이미지(멀티모달)는 content block으로 마지막 user 메시지에 붙인다
    if (request.images && request.images.length > 0) {
      const imageBlocks: Anthropic.ImageBlockParam[] = request.images.map(
        (image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type:
              image.mimeType as Anthropic.Base64ImageSource["media_type"],
            data: image.base64,
          },
        }),
      );
      const lastUserIndex = messages
        .map((message) => message.role)
        .lastIndexOf("user");
      const target = messages[lastUserIndex];
      if (target && typeof target.content === "string") {
        target.content = [
          ...imageBlocks,
          { type: "text", text: target.content },
        ];
      }
    }

    const model = request.model ?? this.defaultModel;
    const response = await this.client.messages.create({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(system.length > 0 ? { system } : {}),
      messages,
    });

    // 운영 방어 (TASK-0903 — 0901-② 정책): JSON 출력이 max_tokens에서 잘리면
    // 명확한 오류로 실패시킨다. 텍스트 출력은 부분 결과 허용.
    if (
      response.stop_reason === "max_tokens" &&
      request.responseFormat === "json"
    ) {
      throw new Error(
        `Anthropic 응답이 출력 한도(max tokens)에서 잘려 JSON을 완성하지 못했습니다 — ` +
          `LLM_*_MAX_TOKENS 한도를 늘리거나 프롬프트를 줄여 주세요. (model: ${response.model})`,
      );
    }

    const text = response.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      )
      .map((block) => block.text)
      .join("");

    return {
      provider: this.name,
      model: response.model,
      text,
      usage: {
        inputTokens: response.usage.input_tokens ?? null,
        outputTokens: response.usage.output_tokens ?? null,
      },
      raw: response,
    };
  }
}
