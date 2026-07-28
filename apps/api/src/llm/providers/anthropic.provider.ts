import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmRequest, LlmResult } from "@acos/core";

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Anthropic(Claude) 어댑터 — 공식 @anthropic-ai/sdk 사용.
 * ANTHROPIC_API_KEY가 설정된 경우에만 LLM_PROVIDER=anthropic으로 선택된다.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  private readonly client: Anthropic;

  constructor(options: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    // Anthropic API는 system을 별도 파라미터로 받는다
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
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
