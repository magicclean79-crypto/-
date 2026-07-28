import type { LlmProvider, LlmRequest, LlmResult } from "../llm-provider";

/** 메시지들에 포함된 마지막 ```json 펜스 블록의 내용을 찾는다 */
function findLastJsonBlock(request: LlmRequest): string | null {
  let last: string | null = null;
  for (const message of request.messages) {
    for (const match of message.content.matchAll(
      /```json\s*\n([\s\S]*?)```/g,
    )) {
      last = match[1].trim();
    }
  }
  return last;
}

/**
 * 기본 LLM Provider — 실제 AI API를 호출하지 않는 결정적 mock.
 * 마지막 user 메시지를 반영한 응답을 생성해 파이프라인을 오프라인으로 검증한다.
 *
 * responseFormat="json"이면 프롬프트에 포함된 마지막 ```json 블록(템플릿이
 * 넣어 준 규칙 기반 초안)을 그대로 반환한다 — 구조화 출력 파이프라인을
 * 실제 모델 없이 결정적으로 검증하기 위한 동작 (TASK-0504).
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
      request.responseFormat === "json"
        ? (findLastJsonBlock(request) ?? "{}")
        : `[mock-llm] ${lastUser?.content.slice(0, 200) ?? "(user 메시지 없음)"}` +
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
        responseFormat: request.responseFormat ?? "text",
      },
    };
  }
}
