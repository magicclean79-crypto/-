import type Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicLlmProvider,
  type AnthropicMessagesClient,
} from "./anthropic.provider";

function createFakeClient(
  overrides: { text?: string; stopReason?: string } = {},
): {
  client: AnthropicMessagesClient;
  calls: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AnthropicMessagesClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return {
          id: "msg-1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          content: [
            { type: "text", text: overrides.text ?? '{"name": "매트"}' },
          ],
          stop_reason: overrides.stopReason ?? "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 140, output_tokens: 36 },
        } as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

describe("AnthropicLlmProvider (TASK-0903 — 공식 연결)", () => {
  const request = {
    messages: [
      { role: "system" as const, content: "JSON으로 답하라." },
      { role: "user" as const, content: "상품을 분석해줘." },
    ],
  };

  it("응답 텍스트·모델·usage를 LlmResult로 매핑한다 (system 분리)", async () => {
    const { client, calls } = createFakeClient();
    const provider = new AnthropicLlmProvider({ apiKey: "test", client });

    const result = await provider.complete(request);

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-5");
    expect(result.text).toBe('{"name": "매트"}');
    expect(result.usage).toEqual({ inputTokens: 140, outputTokens: 36 });
    // system은 별도 파라미터, messages에는 user만 남는다
    expect(calls[0].system).toBe("JSON으로 답하라.");
    expect(calls[0].messages).toEqual([
      { role: "user", content: "상품을 분석해줘." },
    ]);
  });

  it('responseFormat "json" → JSON 전용 system 지시 강화 (prefill 미사용 — Claude 4.6+ 400)', async () => {
    const { client, calls } = createFakeClient();
    const provider = new AnthropicLlmProvider({ apiKey: "test", client });

    await provider.complete({ ...request, responseFormat: "json" });

    expect(String(calls[0].system)).toContain("JSON 객체 하나여야 한다");
    // assistant prefill을 추가하지 않는다 (마지막 메시지는 user)
    const last = calls[0].messages[calls[0].messages.length - 1];
    expect(last.role).toBe("user");
  });

  it("이미지는 base64 image block으로 마지막 user 메시지에 첨부된다", async () => {
    const { client, calls } = createFakeClient();
    const provider = new AnthropicLlmProvider({ apiKey: "test", client });

    await provider.complete({
      ...request,
      images: [{ mimeType: "image/jpeg", base64: "aGVsbG8=" }],
    });

    const content = calls[0].messages[0]
      .content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "aGVsbG8=",
      },
    });
    expect(content[1]).toEqual({ type: "text", text: "상품을 분석해줘." });
  });

  it("JSON 잘림(stop_reason=max_tokens) → 명확한 오류 (0901-② 정책)", async () => {
    const { client } = createFakeClient({
      text: '{"name": "잘린',
      stopReason: "max_tokens",
    });
    const provider = new AnthropicLlmProvider({ apiKey: "test", client });

    await expect(
      provider.complete({ ...request, responseFormat: "json" }),
    ).rejects.toThrow("출력 한도(max tokens)에서 잘려");

    // 텍스트 출력은 부분 결과 허용
    const partial = createFakeClient({
      text: "부분 텍스트",
      stopReason: "max_tokens",
    });
    const textProvider = new AnthropicLlmProvider({
      apiKey: "test",
      client: partial.client,
    });
    await expect(textProvider.complete(request)).resolves.toMatchObject({
      text: "부분 텍스트",
    });
  });
});
