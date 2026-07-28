import type OpenAI from "openai";
import {
  createDefaultPromptEngine,
  LlmAnalysisProvider,
  LlmVisionProvider,
} from "@acos/core";
import type { ExecutionRecord, ExecutionStore, NewExecution } from "@acos/core";
import { LlmService } from "./llm.service";
import { OpenAiLlmProvider } from "./providers/openai.provider";
import type { OpenAiChatClient } from "./providers/openai.provider";

/**
 * OpenAI Production 통합 검증. (TASK-0901, Sprint 9)
 *
 * 주입 클라이언트(OpenAiChatClient)로 실 OpenAI 응답 형태를 재현해,
 * 3개 엔진(Content/Analysis/Vision) 전 경로가 실제 Provider와 올바르게
 * 연결되는지 검증한다: 요청 매핑(json_object·image_url·max tokens) →
 * 응답 파싱(초안 echo가 아닌 실 모델 응답) → Execution 기록(스냅샷 모델
 * 접두사 매칭 비용). 실키 네트워크 호출은 운영/스테이징 스모크에서 수행.
 */

const SNAPSHOT_MODEL = "gpt-4o-2024-08-06"; // 실 응답은 스냅샷 모델명을 반환한다

function fakeCompletion(
  text: string,
  options: { finishReason?: string } = {},
): OpenAI.Chat.ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: SNAPSHOT_MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text, refusal: null },
        finish_reason: (options.finishReason ?? "stop") as "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 640,
      total_tokens: 1840,
    },
  };
}

describe("OpenAI Production 통합 (TASK-0901)", () => {
  let captured: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[];
  let nextResponse: OpenAI.Chat.ChatCompletion;
  let executions: (NewExecution & { id: string })[];
  let llm: LlmService;
  const promptEngine = createDefaultPromptEngine();

  beforeEach(() => {
    captured = [];
    executions = [];
    nextResponse = fakeCompletion("{}");
    const client: OpenAiChatClient = {
      chat: {
        completions: {
          create: async (params) => {
            captured.push(params);
            return nextResponse;
          },
        },
      },
    };
    const store: ExecutionStore = {
      record: async (entry: NewExecution) => {
        const record = { ...entry, id: `exec-${executions.length + 1}` };
        executions.push(record);
        return { ...record, createdAt: new Date() } as ExecutionRecord;
      },
    };
    llm = new LlmService(
      new OpenAiLlmProvider({ apiKey: "test-key", client }),
      store,
    );
  });

  const emptyCompanyBrain = {
    knowledge: [],
    decisions: [],
    memories: [],
  };

  it("Content Generation — 텍스트 경로: 운영 max tokens(4096)·모델 스냅샷·비용 기록", async () => {
    nextResponse = fakeCompletion(
      "# 프리미엄 청소포 상세페이지\n\n실 모델이 생성한 본문입니다.",
    );
    const completion = await llm.complete(
      {
        messages: promptEngine.render("content-generation", {
          project: { name: "테스트", description: null },
          productObject: {
            version: 1,
            title: "프리미엄 청소포",
            brand: null,
            category: null,
            attributes: {},
            ocrText: null,
            visionLabels: [],
          },
          companyBrain: { ...emptyCompanyBrain, bannedWords: null },
        }),
      },
      { feature: "content-generation" },
    );

    expect(completion.provider).toBe("openai");
    expect(completion.model).toBe(SNAPSHOT_MODEL);
    expect(completion.text).toContain("프리미엄 청소포 상세페이지");
    // 운영 출력 상한 — feature 기본 4096이 어댑터로 전달된다
    expect(captured[0].max_completion_tokens).toBe(4096);
    expect(captured[0].response_format).toBeUndefined();
    // Execution: 스냅샷 모델명 기록 + 접두사 매칭(gpt-4o)으로 비용 산정
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      feature: "content-generation",
      provider: "openai",
      model: SNAPSHOT_MODEL,
      status: "SUCCESS",
      inputTokens: 1200,
      outputTokens: 640,
    });
    // gpt-4o: $2.5/1M input + $10/1M output
    expect(executions[0].cost).toBeCloseTo(
      (1200 / 1e6) * 2.5 + (640 / 1e6) * 10,
      10,
    );
  });

  it("Product Analysis — json_object 강제·실 모델 응답(초안과 다름) 엄격 파싱", async () => {
    nextResponse = fakeCompletion(
      JSON.stringify({
        name: "실모델이 보강한 상품명",
        category: "생활용품",
        keywords: ["청소", "다목적"],
        description: "OCR 근거 요약",
        attributes: { 용량: "20매" },
        confidence: 0.87,
      }),
    );
    const provider = new LlmAnalysisProvider({
      promptEngine,
      llmProviderName: "openai",
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

    // 요청 매핑: 구조화 출력 + 분석 상한 2048
    expect(captured[0].response_format).toEqual({ type: "json_object" });
    expect(captured[0].max_completion_tokens).toBe(2048);
    // 실 모델 응답(초안 echo 아님)이 그대로 파싱된다
    expect(result.analysis.name).toBe("실모델이 보강한 상품명");
    expect(result.analysis.confidence).toBe(0.87);
    expect(
      (result.raw as { llm: { provider: string; model: string } }).llm,
    ).toEqual({
      provider: "openai",
      model: SNAPSHOT_MODEL,
    });
    expect(executions[0]).toMatchObject({
      feature: "product-analysis",
      provider: "openai",
      status: "SUCCESS",
    });
    expect(executions[0].cost).toBeGreaterThan(0);
  });

  it("Vision Analysis — 이미지가 image_url(data URL)로 첨부되고 JSON 파싱된다", async () => {
    nextResponse = fakeCompletion(
      JSON.stringify({
        labels: ["청소포", "패키지"],
        brand: "매직클린",
        category: "생활용품",
        suggestedTitle: "매직클린 다목적 청소포",
        confidence: 0.9,
      }),
    );
    const imageBytes = Buffer.from("fake-image-bytes");
    const provider = new LlmVisionProvider({
      promptEngine,
      llmProviderName: "openai",
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
          getBytes: async () => imageBytes,
        },
      ],
      ocrTexts: [],
    });

    // 요청 매핑: 멀티모달 image_url(data URL) + json_object + vision 상한 2048
    const userMessage = [...captured[0].messages]
      .reverse()
      .find((message) => message.role === "user");
    const parts = userMessage?.content as OpenAI.Chat.ChatCompletionContentPart[];
    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0]).toEqual({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${imageBytes.toString("base64")}`,
      },
    });
    expect(captured[0].response_format).toEqual({ type: "json_object" });
    expect(captured[0].max_completion_tokens).toBe(2048);
    // 파싱 결과
    expect(result.summary.brand).toBe("매직클린");
    expect(result.summary.source).toBe("llm:openai");
    expect(executions[0]).toMatchObject({
      feature: "vision-analysis",
      provider: "openai",
      status: "SUCCESS",
    });
  });

  it("Model Routing — LLM_MODEL_ANALYSIS 지정 시 해당 모델로 호출된다 (TASK-0902)", async () => {
    process.env.LLM_MODEL_ANALYSIS = "gpt-4o-mini";
    try {
      nextResponse = fakeCompletion("{}");
      await llm.complete(
        {
          messages: [{ role: "user", content: "분석" }],
          responseFormat: "json",
        },
        { feature: "product-analysis" },
      );
      expect(captured[0].model).toBe("gpt-4o-mini");

      // 호출자가 model을 명시하면 라우팅보다 우선한다
      await llm.complete(
        {
          messages: [{ role: "user", content: "분석" }],
          model: "gpt-4o",
        },
        { feature: "product-analysis" },
      );
      expect(captured[1].model).toBe("gpt-4o");
      // 라우팅 없는 feature는 Provider 기본 모델
      await llm.complete(
        { messages: [{ role: "user", content: "생성" }] },
        { feature: "content-generation" },
      );
      expect(captured[2].model).toBe("gpt-4o");
    } finally {
      delete process.env.LLM_MODEL_ANALYSIS;
    }
  });

  it("JSON 출력 잘림(finish_reason=length) — 명확한 오류 + Execution FAILED", async () => {
    nextResponse = fakeCompletion('{"name": "잘린', {
      finishReason: "length",
    });
    await expect(
      llm.complete(
        {
          messages: [{ role: "user", content: "분석해줘" }],
          responseFormat: "json",
        },
        { feature: "product-analysis" },
      ),
    ).rejects.toThrow("출력 한도(max tokens)에서 잘려");

    // 재시도(기본 3회) 후 실패 — Execution은 FAILED 1건으로 기록된다
    const failedRecords = executions.filter(
      (entry) => entry.status === "FAILED",
    );
    expect(failedRecords).toHaveLength(1);
    expect(failedRecords[0].error).toContain("출력 한도");
  });
});
