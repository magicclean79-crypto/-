import type Anthropic from "@anthropic-ai/sdk";
import type { GenerateContentResponse } from "@google/genai";
import type OpenAI from "openai";
import { createDefaultPromptEngine, LlmVisionProvider } from "@acos/core";
import type { ExecutionRecord, ExecutionStore, NewExecution } from "@acos/core";
import {
  AnthropicLlmProvider,
  type AnthropicMessagesClient,
} from "./providers/anthropic.provider";
import {
  GeminiLlmProvider,
  type GeminiGenerateClient,
} from "./providers/gemini.provider";
import {
  OpenAiLlmProvider,
  type OpenAiChatClient,
} from "./providers/openai.provider";
import { LlmService } from "./llm.service";

/**
 * Vision Production 검증. (TASK-1301, Sprint 13)
 *
 * Vision은 Provider마다 **이미지 전달 형식이 전부 다르다** (OpenAI는 data
 * URL, Anthropic은 base64 content block, Gemini는 inlineData). 하나만
 * 맞고 나머지가 틀리면 라우팅·Failover로 Provider가 바뀌는 순간 이미지가
 * 조용히 사라지고 "이미지 없이 추측한 결과"가 정상처럼 기록된다.
 *
 * 그래서 세 Provider 전부에 대해 같은 시나리오를 돌려 확인한다:
 * ① 이미지가 실제로 요청에 실렸는가 ② 결과 출처가 llm:<provider>인가
 * ③ Execution이 vision-analysis로 남는가.
 *
 * 실키 네트워크 검증은 운영/스테이징 스모크 전용 (CTO 결정 0901-③).
 */

const promptEngine = createDefaultPromptEngine();
const IMAGE_BASE64 = Buffer.from("img-bytes").toString("base64");

const VISION_JSON = JSON.stringify({
  labels: ["청소포"],
  brand: "매직클린",
  category: "생활용품",
  suggestedTitle: "매직클린 청소포",
  confidence: 0.8,
});

function createStore(): {
  store: ExecutionStore;
  executions: (NewExecution & { id: string })[];
} {
  const executions: (NewExecution & { id: string })[] = [];
  return {
    executions,
    store: {
      record: async (entry: NewExecution) => {
        const record = { ...entry, id: `exec-${executions.length + 1}` };
        executions.push(record);
        return { ...record, createdAt: new Date() } as ExecutionRecord;
      },
    },
  };
}

async function analyzeWith(llm: LlmService, providerName: string) {
  const provider = new LlmVisionProvider({
    promptEngine,
    llmProviderName: providerName,
    complete: async ({ messages, images, responseFormat }) => {
      const completion = await llm.complete(
        { messages, images, responseFormat },
        { feature: "vision-analysis" },
      );
      return {
        provider: completion.provider,
        model: completion.model,
        text: completion.text,
      };
    },
    loadCompanyBrain: async () => ({
      knowledge: [],
      decisions: [],
      memories: [],
    }),
  });

  return provider.analyze({
    project: { id: "pj1", name: "테스트", description: null },
    images: [
      {
        id: "img1",
        mimeType: "image/jpeg",
        getBytes: async () => Buffer.from("img-bytes"),
      },
    ],
    ocrTexts: [],
  });
}

describe("Vision Production (TASK-1301)", () => {
  it("OpenAI — 이미지가 data URL(image_url)로 실린다", async () => {
    const captured: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    const client: OpenAiChatClient = {
      chat: {
        completions: {
          create: async (params) => {
            captured.push(params);
            return {
              id: "cmpl-1",
              model: "gpt-4o-2024-08-06",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: VISION_JSON },
                },
              ],
              usage: { prompt_tokens: 900, completion_tokens: 120 },
            } as unknown as OpenAI.Chat.ChatCompletion;
          },
        },
      },
    };
    const { store, executions } = createStore();
    const llm = new LlmService(
      new OpenAiLlmProvider({ apiKey: "test", client }),
      store,
    );

    const result = await analyzeWith(llm, "openai");

    expect(result.summary.source).toBe("llm:openai");
    const content = captured[0].messages.at(-1)?.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; image_url?: { url: string } }[];
    const image = parts.find((part) => part.type === "image_url")!;
    expect(image.image_url?.url).toBe(
      `data:image/jpeg;base64,${IMAGE_BASE64}`,
    );
    expect(executions[0]).toMatchObject({
      feature: "vision-analysis",
      provider: "openai",
      status: "SUCCESS",
    });
  });

  it("Anthropic — 이미지가 base64 image block으로 실린다", async () => {
    const captured: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: AnthropicMessagesClient = {
      messages: {
        create: async (params) => {
          captured.push(params);
          return {
            id: "msg-1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: VISION_JSON }],
            usage: { input_tokens: 900, output_tokens: 120 },
          } as unknown as Anthropic.Message;
        },
      },
    };
    const { store, executions } = createStore();
    const llm = new LlmService(
      new AnthropicLlmProvider({ apiKey: "test", client }),
      store,
    );

    const result = await analyzeWith(llm, "anthropic");

    expect(result.summary.source).toBe("llm:anthropic");
    const content = captured[0].messages.at(-1)?.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as Anthropic.ImageBlockParam[];
    const image = blocks.find((block) => block.type === "image")!;
    expect(image.source).toMatchObject({
      type: "base64",
      media_type: "image/jpeg",
      data: IMAGE_BASE64,
    });
    // vision 상한(2048)이 전달된다 — 잘린 JSON은 실패로 처리되므로 중요하다
    expect(captured[0].max_tokens).toBe(2048);
    expect(executions[0]).toMatchObject({
      feature: "vision-analysis",
      provider: "anthropic",
      status: "SUCCESS",
    });
  });

  it("Gemini — 이미지가 inlineData로 실린다", async () => {
    const captured: Record<string, unknown>[] = [];
    const client: GeminiGenerateClient = {
      models: {
        generateContent: async (params) => {
          captured.push(params as unknown as Record<string, unknown>);
          return {
            text: VISION_JSON,
            modelVersion: "gemini-2.5-flash-002",
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: {
              promptTokenCount: 900,
              candidatesTokenCount: 120,
            },
          } as unknown as GenerateContentResponse;
        },
      },
    };
    const { store, executions } = createStore();
    const llm = new LlmService(
      new GeminiLlmProvider({ apiKey: "test", client }),
      store,
    );

    const result = await analyzeWith(llm, "gemini");

    expect(result.summary.source).toBe("llm:gemini");
    const contents = captured[0].contents as {
      parts: { inlineData?: { mimeType: string; data: string } }[];
    }[];
    const parts = contents.at(-1)!.parts;
    const image = parts.find((part) => part.inlineData)!;
    expect(image.inlineData).toEqual({
      mimeType: "image/jpeg",
      data: IMAGE_BASE64,
    });
    expect(executions[0]).toMatchObject({
      feature: "vision-analysis",
      provider: "gemini",
      status: "SUCCESS",
    });
  });

  it("이미지가 없으면 어느 Provider에서도 이미지 파트를 만들지 않는다", async () => {
    // Vision 폴백 경로 — 빈 이미지 배열로 헛된 첨부가 생기면 요청이 깨진다
    const captured: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    const client: OpenAiChatClient = {
      chat: {
        completions: {
          create: async (params) => {
            captured.push(params);
            return {
              id: "cmpl-1",
              model: "gpt-4o",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: "ok" },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            } as unknown as OpenAI.Chat.ChatCompletion;
          },
        },
      },
    };
    const llm = new LlmService(new OpenAiLlmProvider({ apiKey: "t", client }));
    await llm.complete({
      messages: [{ role: "user", content: "설명" }],
      images: [],
    });
    expect(typeof captured[0].messages.at(-1)?.content).toBe("string");
  });
});
