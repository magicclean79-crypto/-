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
    const model = request.model ?? this.defaultModel;
    const response = await this.client.chat.completions.create({
      model,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
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
