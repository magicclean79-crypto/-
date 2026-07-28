import type OpenAI from "openai";
import { OpenAiLlmProvider, type OpenAiChatClient } from "./openai.provider";

function createFakeClient(): {
  client: OpenAiChatClient;
  calls: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[];
} {
  const calls: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
  const client: OpenAiChatClient = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 0,
            model: "gpt-4o-2024-08-06",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: '{"name": "매트"}',
                  refusal: null,
                },
                finish_reason: "stop",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 30,
              total_tokens: 150,
            },
          } as OpenAI.Chat.ChatCompletion;
        },
      },
    },
  };
  return { client, calls };
}

describe("OpenAiLlmProvider (TASK-0603 — 공식 연결)", () => {
  const request = {
    messages: [
      { role: "system" as const, content: "JSON으로 답하라." },
      { role: "user" as const, content: "상품을 분석해줘." },
    ],
  };

  it("응답 텍스트·모델·usage를 LlmResult로 매핑한다", async () => {
    const { client } = createFakeClient();
    const provider = new OpenAiLlmProvider({ apiKey: "test", client });

    const result = await provider.complete(request);

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-2024-08-06"); // 실제 응답 모델(스냅샷)
    expect(result.text).toBe('{"name": "매트"}');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it('responseFormat "json"이면 response_format json_object를 전달한다', async () => {
    const { client, calls } = createFakeClient();
    const provider = new OpenAiLlmProvider({ apiKey: "test", client });

    await provider.complete({ ...request, responseFormat: "json" });
    await provider.complete(request); // 기본(text)에서는 미전달

    expect(calls[0].response_format).toEqual({ type: "json_object" });
    expect(calls[1].response_format).toBeUndefined();
  });

  it("이미지는 data URL(image_url)로 마지막 user 메시지에 첨부된다 (멀티모달)", async () => {
    const { client, calls } = createFakeClient();
    const provider = new OpenAiLlmProvider({ apiKey: "test", client });

    await provider.complete({
      ...request,
      images: [{ mimeType: "image/png", base64: "aW1n" }],
    });

    const userMessage = calls[0].messages[1];
    expect(userMessage.content).toEqual([
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,aW1n" },
      },
      { type: "text", text: "상품을 분석해줘." },
    ]);
  });

  it("모델·maxTokens 옵션이 전달된다 (기본 gpt-4o)", async () => {
    const { client, calls } = createFakeClient();
    const provider = new OpenAiLlmProvider({ apiKey: "test", client });

    await provider.complete(request);
    await provider.complete({ ...request, model: "gpt-4o-mini", maxTokens: 64 });

    expect(calls[0].model).toBe("gpt-4o");
    expect(calls[0].max_completion_tokens).toBe(1024);
    expect(calls[1].model).toBe("gpt-4o-mini");
    expect(calls[1].max_completion_tokens).toBe(64);
  });
});
