import OpenAI from "openai";
import type { LlmProvider, LlmRequest, LlmResult } from "@acos/core";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * OpenAI 어댑터 — 공식 openai SDK 사용.
 * OPENAI_API_KEY가 설정된 경우에만 LLM_PROVIDER=openai로 선택된다.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = "openai";
  readonly defaultModel: string;
  private readonly client: OpenAI;

  constructor(options: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
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
    });

    return {
      provider: this.name,
      model: response.model,
      text: response.choices[0]?.message?.content ?? "",
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      },
      raw: response,
    };
  }
}
