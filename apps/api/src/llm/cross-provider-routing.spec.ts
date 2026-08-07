import { MockLlmProvider } from "@acos/core";
import type {
  ExecutionRecord,
  ExecutionStore,
  LlmProvider,
  LlmRequest,
  LlmResult,
  NewExecution,
} from "@acos/core";
import { LlmService } from "./llm.service";

/**
 * Cross-Provider Routing Engine 검증. (TASK-1001, Sprint 10)
 *
 * feature별 Provider 매핑이 호출 시점에 해석되어(Dynamic) 실제로 다른
 * Provider로 호출되고, Execution에 그 경로가 기록되는지 검증한다.
 * (Provider Failover는 CTO 지시로 범위 제외 — 설정 해석 시점의 폴백만)
 */

/** 이름만 다른 결정적 Provider — 어느 Provider로 갔는지 추적용 */
class StubProvider implements LlmProvider {
  readonly calls: LlmRequest[] = [];
  constructor(
    readonly name: string,
    readonly defaultModel: string,
  ) {}
  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls.push(request);
    return {
      provider: this.name,
      model: request.model ?? this.defaultModel,
      text: `${this.name} 응답`,
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: {},
    };
  }
}

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

const MESSAGES = [{ role: "user" as const, content: "안녕" }];

describe("Cross-Provider Routing Engine (TASK-1001)", () => {
  const ROUTE_ENVS = [
    "LLM_ROUTE_CONTENT",
    "LLM_ROUTE_ANALYSIS",
    "LLM_ROUTE_VISION",
    "LLM_MODEL_CONTENT",
    "LLM_MODEL_ANALYSIS",
    "LLM_MODEL_VISION",
  ];

  afterEach(() => {
    for (const env of ROUTE_ENVS) {
      delete process.env[env];
    }
  });

  function createService() {
    const mock = new MockLlmProvider();
    const openai = new StubProvider("openai", "gpt-4o");
    const anthropic = new StubProvider("anthropic", "claude-opus-5");
    const { store, executions } = createStore();
    const service = new LlmService(
      mock,
      store,
      undefined,
      new Map<string, LlmProvider>([
        ["mock", mock],
        ["openai", openai],
        ["anthropic", anthropic],
      ]),
    );
    return { service, openai, anthropic, executions };
  }

  it("feature별 Provider 매핑 — 지정한 Provider로 호출되고 Execution에 기록된다", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    process.env.LLM_ROUTE_VISION = "openai:gpt-4o-mini";
    const { service, openai, anthropic, executions } = createService();

    const analysis = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );
    expect(analysis.provider).toBe("anthropic");
    expect(anthropic.calls).toHaveLength(1);

    const vision = await service.complete(
      { messages: MESSAGES },
      { feature: "vision-analysis" },
    );
    expect(vision.provider).toBe("openai");
    expect(vision.model).toBe("gpt-4o-mini"); // 규칙의 provider:model 적용
    expect(openai.calls[0].model).toBe("gpt-4o-mini");

    // 매핑 없는 feature는 기본 Provider(mock)
    const content = await service.complete(
      { messages: MESSAGES },
      { feature: "content-generation" },
    );
    expect(content.provider).toBe("mock");

    // Routing Metrics 원천: Execution에 경로가 그대로 남는다
    expect(
      executions.map((entry) => `${entry.feature}→${entry.provider}`),
    ).toEqual([
      "product-analysis→anthropic",
      "vision-analysis→openai",
      "content-generation→mock",
    ]);
  });

  it("Dynamic — 재기동 없이 환경 변경이 다음 호출부터 반영된다", async () => {
    const { service } = createService();

    expect(
      (await service.complete({ messages: MESSAGES }, { feature: "product-analysis" }))
        .provider,
    ).toBe("mock");

    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    expect(
      (await service.complete({ messages: MESSAGES }, { feature: "product-analysis" }))
        .provider,
    ).toBe("anthropic");

    process.env.LLM_ROUTE_ANALYSIS = "openai";
    expect(
      (await service.complete({ messages: MESSAGES }, { feature: "product-analysis" }))
        .provider,
    ).toBe("openai");
  });

  it("사용할 수 없는 Provider 매핑은 기본 Provider로 내려간다 (호출 실패 아님)", async () => {
    process.env.LLM_ROUTE_CONTENT = "gemini"; // 키 미설정 — 맵에 없음
    const { service, executions } = createService();

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "content-generation" },
    );
    expect(result.provider).toBe("mock");
    expect(executions[0]).toMatchObject({
      feature: "content-generation",
      provider: "mock",
      status: "SUCCESS",
    });

    const routing = service.routing();
    const route = routing.routes.find(
      (item) => item.feature === "content-generation",
    );
    expect(route).toMatchObject({ provider: "mock", source: "fallback" });
    expect(route?.reason).toContain("gemini");
  });

  it("호출자가 model을 명시하면 라우팅 모델보다 우선한다", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai:gpt-4o-mini";
    const { service, openai } = createService();

    const result = await service.complete(
      { messages: MESSAGES, model: "gpt-4o" },
      { feature: "product-analysis" },
    );
    expect(result.provider).toBe("openai");
    expect(openai.calls[0].model).toBe("gpt-4o");
  });

  it("GET /llm/routing 원천 — 라우팅 표에 결정 근거·환경변수명이 포함된다", () => {
    process.env.LLM_ROUTE_VISION = "anthropic";
    const { service } = createService();

    const routing = service.routing();
    expect(routing.defaultProvider).toBe("mock");
    expect(routing.availableProviders).toEqual(["mock", "openai", "anthropic"]);
    expect(routing.routes.map((route) => route.feature)).toEqual([
      "content-generation",
      "product-analysis",
      "vision-analysis",
      "design-review",
    ]);
    expect(
      routing.routes.find((route) => route.feature === "vision-analysis"),
    ).toMatchObject({
      provider: "anthropic",
      source: "feature",
      env: "LLM_ROUTE_VISION",
    });
    expect(
      routing.routes.find((route) => route.feature === "content-generation"),
    ).toMatchObject({ provider: "mock", source: "default" });
  });

  it("Provider 맵이 없으면 단일 Provider로 동작한다 (하위 호환)", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    const service = new LlmService(new MockLlmProvider());

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );
    expect(result.provider).toBe("mock"); // anthropic 인스턴스 없음 → 폴백
    expect(service.routing().availableProviders).toEqual(["mock"]);
  });
});
