import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";

import { AnthropicLlmProvider } from "./anthropic.provider";
import { GeminiLlmProvider } from "./gemini.provider";
import { OpenAiLlmProvider } from "./openai.provider";

/**
 * 세 어댑터가 **같은 칸에 같은 뜻**을 담는가. (TASK-4701, 지시 2)
 *
 * 이 파일이 검사하는 것은 매핑의 정확성이 아니라 **일관성**입니다. 지금까지
 * 세 Provider의 `usage`를 그대로 옮겨 담고 있었는데, 그 값들의 뜻이
 * 서로 달랐습니다:
 *
 * | Provider | 무엇이 어긋났는가 | 방향 |
 * | --- | --- | --- |
 * | Anthropic | 입력이 캐시를 **빼고** 온다 | 실제보다 **적게** |
 * | OpenAI | 입력이 캐시를 **포함**한다(캐시는 싸다) | 실제보다 **많이** |
 * | Gemini | 생각 토큰이 출력에 **없다**(청구는 된다) | 실제보다 **적게** |
 *
 * 세 방향이 다르므로 합계는 어느 쪽으로도 못 믿었습니다.
 */

const request = {
  messages: [{ role: "user" as const, content: "안녕" }],
};

describe("OpenAI — 캐시 토큰을 입력에서 뺀다", () => {
  function client(usage: Record<string, unknown>) {
    return {
      chat: {
        completions: {
          create: async () =>
            ({
              id: "c1",
              model: "gpt-4o-2024-08-06",
              choices: [
                { index: 0, message: { role: "assistant", content: "네" }, finish_reason: "stop" },
              ],
              usage,
            }) as unknown as OpenAI.Chat.ChatCompletion,
        },
      },
    } as unknown as OpenAI;
  }

  it("캐시된 입력을 빼고 상세에 남긴다", async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: "t",
      client: client({
        prompt_tokens: 1000,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 800 },
      }),
    });
    const result = await provider.complete(request);
    // 1000 중 800이 캐시 → 새로 청구되는 것은 200
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usageDetail?.cachedInputTokens).toBe(800);
  });

  /** OpenAI는 캐시 쓰기에 값을 매기지 않는다 — 개념이 없으므로 null(0이 아니다) */
  it("없는 개념은 null로 둔다", async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: "t",
      client: client({ prompt_tokens: 100, completion_tokens: 10 }),
    });
    const result = await provider.complete(request);
    expect(result.usageDetail?.cacheWriteTokens).toBeNull();
  });

  /** 생각 토큰은 completion_tokens에 이미 들어 있다 — 빼면 청구서보다 적게 센다 */
  it("생각 토큰을 출력에서 빼지 않는다", async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: "t",
      client: client({
        prompt_tokens: 100,
        completion_tokens: 500,
        completion_tokens_details: { reasoning_tokens: 400 },
      }),
    });
    const result = await provider.complete(request);
    expect(result.usage.outputTokens).toBe(500);
    expect(result.usageDetail?.reasoningTokens).toBe(400);
  });

  it("usage가 아예 없으면 모른다로 둔다", async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: "t",
      client: client(undefined as unknown as Record<string, unknown>),
    });
    const result = await provider.complete(request);
    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.outputTokens).toBeNull();
  });
});

describe("Anthropic — 입력은 이미 캐시를 뺀 값이다", () => {
  function client(usage: Record<string, unknown>) {
    return {
      messages: {
        create: async () =>
          ({
            id: "m1",
            model: "claude-opus-5",
            content: [{ type: "text", text: "네" }],
            stop_reason: "end_turn",
            usage,
          }) as unknown as Anthropic.Message,
      },
    } as unknown as Anthropic;
  }

  it("캐시 읽기·쓰기를 따로 받는다", async () => {
    const provider = new AnthropicLlmProvider({
      apiKey: "t",
      client: client({
        input_tokens: 200,
        output_tokens: 100,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 50,
      }),
    });
    const result = await provider.complete(request);
    // 빼지 않는다 — Anthropic이 이미 뺀 값을 준다
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usageDetail?.cachedInputTokens).toBe(800);
    expect(result.usageDetail?.cacheWriteTokens).toBe(50);
  });

  /**
   * Anthropic은 생각 토큰을 따로 세어 주지 않는다 — output_tokens 안에
   * 들어 있고 얼마인지는 **우리가 알 수 없다.** 0으로 채우지 않는다.
   */
  it("모르는 것을 0으로 채우지 않는다", async () => {
    const provider = new AnthropicLlmProvider({
      apiKey: "t",
      client: client({ input_tokens: 10, output_tokens: 5 }),
    });
    const result = await provider.complete(request);
    expect(result.usageDetail?.reasoningTokens).toBeNull();
    expect(result.usageDetail?.cachedInputTokens).toBeNull();
  });
});

describe("Gemini — 생각 토큰이 출력에 없다", () => {
  function client(usageMetadata: Record<string, unknown>) {
    return {
      models: {
        generateContent: async () => ({
          text: "네",
          modelVersion: "gemini-2.5-flash",
          candidates: [{ finishReason: "STOP" }],
          usageMetadata,
        }),
      },
    } as unknown as ConstructorParameters<typeof GeminiLlmProvider>[0]["client"];
  }

  /**
   * 이것이 이 파일에서 가장 중요한 검사다. 생각 토큰은 청구되는데
   * `candidatesTokenCount`에 없다 — 더하지 않으면 생각을 많이 한 호출일수록
   * 크게 어긋난다.
   */
  it("생각 토큰을 출력에 더한다", async () => {
    const provider = new GeminiLlmProvider({
      apiKey: "t",
      client: client({
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 300,
      }),
    });
    const result = await provider.complete(request);
    expect(result.usage.outputTokens).toBe(350);
    expect(result.usageDetail?.reasoningTokens).toBe(300);
  });

  it("캐시된 입력을 빼고 상세에 남긴다", async () => {
    const provider = new GeminiLlmProvider({
      apiKey: "t",
      client: client({
        promptTokenCount: 1000,
        cachedContentTokenCount: 700,
        candidatesTokenCount: 20,
      }),
    });
    const result = await provider.complete(request);
    expect(result.usage.inputTokens).toBe(300);
    expect(result.usageDetail?.cachedInputTokens).toBe(700);
  });

  /**
   * Gemini의 캐시 쓰기는 저장 시간당 과금이라 호출 단위로 셀 수 없다 —
   * 개념이 다르므로 이 칸에 담지 않는다.
   */
  it("호출 단위로 셀 수 없는 것을 담지 않는다", async () => {
    const provider = new GeminiLlmProvider({
      apiKey: "t",
      client: client({ promptTokenCount: 10, candidatesTokenCount: 5 }),
    });
    const result = await provider.complete(request);
    expect(result.usageDetail?.cacheWriteTokens).toBeNull();
  });

  it("usageMetadata가 없으면 모른다로 둔다", async () => {
    const provider = new GeminiLlmProvider({
      apiKey: "t",
      client: client(undefined as unknown as Record<string, unknown>),
    });
    const result = await provider.complete(request);
    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.outputTokens).toBeNull();
  });
});

describe("세 어댑터가 같은 약속을 지킨다", () => {
  /**
   * 어댑터는 **세 칸을 모두 명시**한다. 빠뜨리면 "몰라서 없는 것"과
   * "그 Provider에 개념이 없는 것"을 구별할 수 없다.
   */
  it("상세의 세 칸을 모두 명시한다", async () => {
    const results = await Promise.all([
      new OpenAiLlmProvider({
        apiKey: "t",
        client: {
          chat: {
            completions: {
              create: async () =>
                ({
                  model: "gpt-4o",
                  choices: [{ message: { content: "x" }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 1, completion_tokens: 1 },
                }) as unknown as OpenAI.Chat.ChatCompletion,
            },
          },
        } as unknown as OpenAI,
      }).complete(request),
      new AnthropicLlmProvider({
        apiKey: "t",
        client: {
          messages: {
            create: async () =>
              ({
                model: "claude-opus-5",
                content: [{ type: "text", text: "x" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }) as unknown as Anthropic.Message,
          },
        } as unknown as Anthropic,
      }).complete(request),
    ]);

    for (const result of results) {
      expect(result.usageDetail).toBeDefined();
      expect(Object.keys(result.usageDetail ?? {}).sort()).toEqual([
        "cacheWriteTokens",
        "cachedInputTokens",
        "reasoningTokens",
      ]);
    }
  });
});
