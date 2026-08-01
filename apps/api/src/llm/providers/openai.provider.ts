import OpenAI from "openai";
import type { LlmProvider, LlmRequest, LlmResult } from "@acos/core";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 1024;

/** 테스트에서 대체 가능한 최소 클라이언트 표면 (chat.completions.create) */
export interface OpenAiChatClient {
  chat: {
    completions: {
      create: (
        params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      ) => Promise<OpenAI.Chat.ChatCompletion>;
    };
  };
}

/**
 * OpenAI 어댑터 — 공식 openai SDK 사용. (TASK-0501 · 공식 연결 TASK-0603)
 * OPENAI_API_KEY가 설정된 경우에만 LLM_PROVIDER=openai로 선택된다.
 *
 * TASK-0603에서 활성화된 것:
 * - responseFormat "json" → response_format { type: "json_object" } 매핑
 *   (프롬프트의 JSON 지침과 이중 강제)
 * - Multimodal: images → image_url(data URL) content part (TASK-0505 유지)
 * - Execution Cost: gpt-4o 계열 단가가 가격표에 등록됨 (@acos/core)
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = "openai";
  readonly defaultModel: string;
  private readonly client: OpenAiChatClient;

  constructor(options: {
    apiKey: string;
    model?: string;
    /** 테스트 전용 — 미지정 시 공식 SDK 클라이언트 생성 */
    client?: OpenAiChatClient;
  }) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] =
      request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

    // 첨부 이미지(멀티모달)는 data URL(image_url)로 마지막 user 메시지에 붙인다
    if (request.images && request.images.length > 0) {
      const lastUserIndex = messages
        .map((message) => message.role)
        .lastIndexOf("user");
      const target = messages[lastUserIndex];
      if (target && typeof target.content === "string") {
        target.content = [
          ...request.images.map((image) => ({
            type: "image_url" as const,
            image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
          })),
          { type: "text" as const, text: target.content },
        ];
      }
    }

    const model = request.model ?? this.defaultModel;
    const response = await this.client.chat.completions.create({
      model,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      // 구조화 출력 — CTO 결정(TASK-0504 승인 ②): 실제 Provider 연결 시 매핑
      ...(request.responseFormat === "json"
        ? { response_format: { type: "json_object" as const } }
        : {}),
    });

    // 운영 방어 (TASK-0901): JSON 출력이 max tokens 한도에서 잘리면 파싱이
    // 불가능하므로 명확한 오류로 실패시킨다 (Execution에 FAILED로 기록됨 —
    // 잘린 JSON 파싱 오류보다 원인 추적이 쉽다). 텍스트 출력은 그대로 반환.
    const choice = response.choices[0];
    if (choice?.finish_reason === "length" && request.responseFormat === "json") {
      throw new Error(
        `OpenAI 응답이 출력 한도(max tokens)에서 잘려 JSON을 완성하지 못했습니다 — ` +
          `LLM_*_MAX_TOKENS 한도를 늘리거나 프롬프트를 줄여 주세요. (model: ${response.model})`,
      );
    }

    // 토큰 상세 (TASK-4701, 지시 2).
    //
    // OpenAI의 `prompt_tokens`는 **캐시 토큰을 포함**합니다. 캐시는 싸게
    // 청구되므로, 포함된 값에 기본 단가를 곱하면 **실제보다 많이** 냈다고
    // 기록하게 됩니다 — Anthropic과 **반대 방향**으로 틀립니다.
    //
    // 그래서 여기서 빼고, 뺀 몫을 상세에 남깁니다. 두 Provider가 같은 칸에
    // 같은 뜻을 담아야 합계를 믿을 수 있습니다.
    const promptTokens = response.usage?.prompt_tokens ?? null;
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? null;

    return {
      provider: this.name,
      model: response.model,
      text: choice?.message?.content ?? "",
      usage: {
        inputTokens:
          promptTokens === null
            ? null
            : Math.max(0, promptTokens - (cachedTokens ?? 0)),
        // `completion_tokens`에는 생각 토큰이 **이미 들어 있습니다** — 빼지
        // 않습니다. 빼면 청구서보다 적게 셉니다.
        outputTokens: response.usage?.completion_tokens ?? null,
      },
      usageDetail: {
        cachedInputTokens: cachedTokens,
        // OpenAI는 캐시 쓰기에 값을 매기지 않습니다 — 개념이 없으므로
        // `null`입니다(0이 아닙니다).
        cacheWriteTokens: null,
        reasoningTokens:
          response.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      },
      raw: response,
    };
  }
}
