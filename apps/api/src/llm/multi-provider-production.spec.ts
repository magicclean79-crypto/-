import type Anthropic from "@anthropic-ai/sdk";
import type { GenerateContentResponse } from "@google/genai";
import {
  createDefaultPromptEngine,
  estimateLlmCost,
  LLM_PROVIDER_REGISTRY,
  LlmAnalysisProvider,
  LlmVisionProvider,
} from "@acos/core";
import type { ExecutionRecord, ExecutionStore, NewExecution } from "@acos/core";
import {
  AnthropicLlmProvider,
  type AnthropicMessagesClient,
} from "./providers/anthropic.provider";
import {
  GeminiLlmProvider,
  type GeminiGenerateClient,
} from "./providers/gemini.provider";
import { LlmService } from "./llm.service";

/**
 * Multi-Provider Production 통합 검증. (TASK-0903, Sprint 9)
 *
 * 주입 클라이언트로 실 응답 형태를 재현해 Anthropic/Gemini가 엔진 →
 * LlmService(단일 관문) → Execution(Unified — 동일 스키마·비용 산정)
 * 전 경로에서 OpenAI와 동일하게 동작하는지 검증한다.
 * 실키 네트워크 검증은 운영/스테이징 스모크 전용 (0901 승인 ③ 정책).
 */

const promptEngine = createDefaultPromptEngine();
const emptyCompanyBrain = { knowledge: [], decisions: [], memories: [] };

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

describe("Multi-Provider Production 통합 (TASK-0903)", () => {
  it("Product Analysis — Anthropic 경유: JSON 지시·상한 전달·Unified Execution 비용", async () => {
    const captured: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: AnthropicMessagesClient = {
      messages: {
        create: async (params) => {
          captured.push(params);
          return {
            id: "msg-1",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  name: "클로드가 보강한 상품명",
                  category: "생활용품",
                  keywords: ["청소"],
                  description: "요약",
                  attributes: {},
                  confidence: 0.9,
                }),
              },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1000, output_tokens: 400 },
          } as Anthropic.Message;
        },
      },
    };
    const { store, executions } = createStore();
    const llm = new LlmService(
      new AnthropicLlmProvider({ apiKey: "test", client }),
      store,
    );
    const provider = new LlmAnalysisProvider({
      promptEngine,
      llmProviderName: "anthropic",
      complete: async ({ messages, responseFormat }) => {
        const completion = await llm.complete(
          { messages, responseFormat },
          { feature: "product-analysis" },
        );
        return {
          provider: completion.provider,
          model: completion.model,
          text: completion.text,
        };
      },
      loadCompanyBrain: async () => emptyCompanyBrain,
    });

    const result = await provider.analyze({
      product: {
        id: "p1",
        projectId: "pj1",
        name: "다목적 청소포",
        description: null,
      },
      images: [],
      ocrTexts: ["다목적 청소포 20매"],
    });

    expect(result.analysis.name).toBe("클로드가 보강한 상품명");
    // 요청 매핑: JSON 지시 강화 + 운영 상한(2048) 전달
    expect(String(captured[0].system)).toContain("JSON 객체 하나여야 한다");
    expect(captured[0].max_tokens).toBe(2048);
    // Unified Execution: 동일 스키마 + claude-opus-5 단가($5/$25 per 1M)
    expect(executions[0]).toMatchObject({
      feature: "product-analysis",
      provider: "anthropic",
      model: "claude-opus-5",
      status: "SUCCESS",
      inputTokens: 1000,
      outputTokens: 400,
    });
    expect(executions[0].cost).toBeCloseTo(
      (1000 / 1e6) * 5 + (400 / 1e6) * 25,
      10,
    );
  });

  it("Vision Analysis — Gemini 경유: inlineData 첨부·JSON 모드·스냅샷 접두사 비용", async () => {
    const captured: Record<string, unknown>[] = [];
    const client: GeminiGenerateClient = {
      models: {
        generateContent: async (params) => {
          captured.push(params as unknown as Record<string, unknown>);
          return {
            text: JSON.stringify({
              labels: ["청소포"],
              brand: "매직클린",
              category: "생활용품",
              suggestedTitle: "매직클린 청소포",
              confidence: 0.85,
            }),
            modelVersion: "gemini-2.5-flash-002",
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: {
              promptTokenCount: 800,
              candidatesTokenCount: 150,
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
    const provider = new LlmVisionProvider({
      promptEngine,
      llmProviderName: "gemini",
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
      loadCompanyBrain: async () => emptyCompanyBrain,
    });

    const result = await provider.analyze({
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

    expect(result.summary.brand).toBe("매직클린");
    expect(result.summary.source).toBe("llm:gemini");
    // 요청 매핑: JSON 모드 + vision 상한(2048) + inlineData 첨부
    const config = captured[0].config as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.maxOutputTokens).toBe(2048);
    // Unified Execution: 스냅샷 모델 접두사 매칭(gemini-2.5-flash) 비용
    expect(executions[0]).toMatchObject({
      feature: "vision-analysis",
      provider: "gemini",
      model: "gemini-2.5-flash-002",
      status: "SUCCESS",
    });
    expect(executions[0].cost).toBeCloseTo(
      (800 / 1e6) * 0.3 + (150 / 1e6) * 2.5,
      10,
    );
  });

  it("Registry의 모든 모델이 가격표에 등록되어 있다 (Unified Execution 보증)", () => {
    for (const info of LLM_PROVIDER_REGISTRY) {
      for (const model of info.models) {
        expect(
          estimateLlmCost(model, { inputTokens: 100, outputTokens: 100 }),
        ).not.toBeNull();
      }
    }
  });
});
