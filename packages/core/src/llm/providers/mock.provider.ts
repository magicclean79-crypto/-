import type { LlmProvider, LlmRequest, LlmResult } from "../llm-provider";

/**
 * 기본 LLM Provider — 실제 AI API를 호출하지 않는 결정적 mock.
 * 마지막 user 메시지를 반영한 응답을 생성해 파이프라인을 오프라인으로 검증한다.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-llm-1";

  async complete(request: LlmRequest): Promise<LlmResult> {
    const lastUser = [...request.messages]
      .reverse()
      .find((message) => message.role === "user");
    const system = request.messages.find(
      (message) => message.role === "system",
    );

    const text =
      `[mock-llm] ${lastUser?.content.slice(0, 200) ?? "(user 메시지 없음)"}` +
      (system ? ` (system 지침 반영: ${system.content.slice(0, 80)})` : "");

    const inputChars = request.messages.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );

    return {
      provider: this.name,
      model: request.model ?? this.defaultModel,
      text,
      usage: {
        // 대략적 추정치 (4자 ≈ 1토큰) — mock 전용
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
      raw: {
        provider: this.name,
        messageCount: request.messages.length,
        maxTokens: request.maxTokens ?? null,
      },
    };
  }
}
