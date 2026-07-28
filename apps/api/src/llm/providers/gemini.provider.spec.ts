import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import {
  GeminiLlmProvider,
  type GeminiGenerateClient,
} from "./gemini.provider";

function createFakeClient(
  overrides: { text?: string; finishReason?: string } = {},
): { client: GeminiGenerateClient; calls: GenerateContentParameters[] } {
  const calls: GenerateContentParameters[] = [];
  const client: GeminiGenerateClient = {
    models: {
      generateContent: async (params) => {
        calls.push(params);
        return {
          text: overrides.text ?? '{"name": "매트"}',
          modelVersion: "gemini-2.5-flash-002",
          candidates: [
            { finishReason: overrides.finishReason ?? "STOP" },
          ],
          usageMetadata: {
            promptTokenCount: 90,
            candidatesTokenCount: 22,
          },
        } as unknown as GenerateContentResponse;
      },
    },
  };
  return { client, calls };
}

describe("GeminiLlmProvider (TASK-0903 — 공식 연결)", () => {
  const request = {
    messages: [
      { role: "system" as const, content: "JSON으로 답하라." },
      { role: "user" as const, content: "상품을 분석해줘." },
    ],
  };

  it("응답 텍스트·스냅샷 모델·usage를 LlmResult로 매핑한다", async () => {
    const { client, calls } = createFakeClient();
    const provider = new GeminiLlmProvider({ apiKey: "test", client });

    const result = await provider.complete(request);

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash-002"); // 스냅샷 → 접두사 매칭 비용
    expect(result.text).toBe('{"name": "매트"}');
    expect(result.usage).toEqual({ inputTokens: 90, outputTokens: 22 });
    const config = (calls[0] as unknown as { config: Record<string, unknown> }).config;
    expect(config.systemInstruction).toBe("JSON으로 답하라.");
  });

  it('responseFormat "json" → responseMimeType application/json 매핑', async () => {
    const { client, calls } = createFakeClient();
    const provider = new GeminiLlmProvider({ apiKey: "test", client });

    await provider.complete({ ...request, responseFormat: "json" });
    const config = (calls[0] as unknown as { config: Record<string, unknown> }).config;
    expect(config.responseMimeType).toBe("application/json");

    // 텍스트 요청에는 미지정
    await provider.complete(request);
    const textConfig = (calls[1] as unknown as { config: Record<string, unknown> })
      .config;
    expect(textConfig.responseMimeType).toBeUndefined();
  });

  it("이미지는 inlineData part로 마지막 user 메시지 앞에 첨부된다", async () => {
    const { client, calls } = createFakeClient();
    const provider = new GeminiLlmProvider({ apiKey: "test", client });

    await provider.complete({
      ...request,
      images: [{ mimeType: "image/png", base64: "aW1n" }],
    });

    const contents = (
      calls[0] as unknown as {
        contents: { role: string; parts: Record<string, unknown>[] }[];
      }
    ).contents;
    expect(contents[0].parts[0]).toEqual({
      inlineData: { mimeType: "image/png", data: "aW1n" },
    });
    expect(contents[0].parts[1]).toEqual({ text: "상품을 분석해줘." });
  });

  it("JSON 잘림(finishReason=MAX_TOKENS) → 명확한 오류 (0901-② 정책)", async () => {
    const { client } = createFakeClient({
      text: '{"name": "잘린',
      finishReason: "MAX_TOKENS",
    });
    const provider = new GeminiLlmProvider({ apiKey: "test", client });

    await expect(
      provider.complete({ ...request, responseFormat: "json" }),
    ).rejects.toThrow("출력 한도(max tokens)에서 잘려");

    // 텍스트 출력은 부분 결과 허용
    const partial = createFakeClient({
      text: "부분 텍스트",
      finishReason: "MAX_TOKENS",
    });
    const textProvider = new GeminiLlmProvider({
      apiKey: "test",
      client: partial.client,
    });
    await expect(textProvider.complete(request)).resolves.toMatchObject({
      text: "부분 텍스트",
    });
  });
});
