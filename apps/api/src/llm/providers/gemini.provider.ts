import { GoogleGenAI } from "@google/genai";
import type { LlmProvider, LlmRequest, LlmResult } from "@acos/core";

const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Google Gemini 어댑터 — 공식 @google/genai SDK 사용.
 * GEMINI_API_KEY가 설정된 경우에만 LLM_PROVIDER=gemini로 선택된다.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly name = "gemini";
  readonly defaultModel: string;
  private readonly client: GoogleGenAI;

  constructor(options: { apiKey: string; model?: string }) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    // Gemini는 system 지침(systemInstruction)과 대화(contents)를 분리해 받는다
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    const contents = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }] as (
          | { text: string }
          | { inlineData: { mimeType: string; data: string } }
        )[],
      }));

    // 첨부 이미지(멀티모달)는 inlineData part로 마지막 user 메시지 앞에 붙인다
    if (request.images && request.images.length > 0) {
      const lastUserIndex = contents
        .map((content) => content.role)
        .lastIndexOf("user");
      const target = contents[lastUserIndex];
      if (target) {
        target.parts = [
          ...request.images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.base64 },
          })),
          ...target.parts,
        ];
      }
    }

    const model = request.model ?? this.defaultModel;
    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        ...(system.length > 0 ? { systemInstruction: system } : {}),
        ...(request.maxTokens !== undefined
          ? { maxOutputTokens: request.maxTokens }
          : {}),
      },
    });

    return {
      provider: this.name,
      model,
      text: response.text ?? "",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? null,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      },
      raw: response,
    };
  }
}
