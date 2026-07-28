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
 * Routing Experiment & Traffic Control 검증. (TASK-1003, Sprint 10)
 *
 * Percentage / A·B / Canary / Weighted는 모두 "가중치 있는 변형 집합"이라는
 * 하나의 원리로 동작한다. 여기서는 배정 결과가 Execution·계측에 정확히
 * 남는지와, 실험이 라우팅·Failover와 어떻게 맞물리는지를 확인한다.
 */

class StubProvider implements LlmProvider {
  calls: (string | undefined)[] = [];
  constructor(
    readonly name: string,
    readonly defaultModel: string,
    private readonly fail = false,
  ) {}
  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls.push(request.model);
    if (this.fail) {
      throw Object.assign(new Error(`${this.name} 오류`), { status: 503 });
    }
    return {
      provider: this.name,
      model: request.model ?? this.defaultModel,
      text: `${this.name} 응답`,
      usage: { inputTokens: 5, outputTokens: 3 },
      raw: {},
    };
  }
}

function createStore(): {
  store: ExecutionStore;
  executions: NewExecution[];
} {
  const executions: NewExecution[] = [];
  return {
    executions,
    store: {
      record: async (entry: NewExecution) => {
        executions.push(entry);
        return { ...entry, id: "exec", createdAt: new Date() } as ExecutionRecord;
      },
    },
  };
}

const MESSAGES = [{ role: "user" as const, content: "안녕" }];

describe("Routing Experiment (TASK-1003)", () => {
  const ENVS = [
    "LLM_EXPERIMENT_ANALYSIS",
    "LLM_EXPERIMENT_CONTENT",
    "LLM_EXPERIMENT_VISION",
    "LLM_ROUTE_ANALYSIS",
    "LLM_FAILOVER_PRIORITY",
    "LLM_MAX_ATTEMPTS",
  ];

  beforeEach(() => {
    process.env.LLM_MAX_ATTEMPTS = "1";
  });

  afterEach(() => {
    for (const env of ENVS) {
      delete process.env[env];
    }
  });

  function createService(options: { openaiFails?: boolean } = {}) {
    const mock = new MockLlmProvider();
    const openai = new StubProvider("openai", "gpt-4o", options.openaiFails);
    const anthropic = new StubProvider("anthropic", "claude-opus-5");
    const { store, executions } = createStore();
    const budget = { assertWithinBudget: jest.fn(async () => undefined) };
    const service = new LlmService(
      mock,
      store,
      budget as never,
      new Map<string, LlmProvider>([
        ["mock", mock],
        ["openai", openai],
        ["anthropic", anthropic],
      ]),
    );
    return { service, openai, anthropic, executions };
  }

  it("Percentage Routing — 가중치대로 트래픽이 나뉘고 배정이 계측된다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=75,anthropic=25";
    const { service, openai, anthropic } = createService();

    for (let i = 0; i < 40; i += 1) {
      await service.complete(
        { messages: MESSAGES },
        { feature: "product-analysis" },
      );
    }

    // 추첨은 확률적이므로 양쪽 모두 호출되고 합계가 맞는지로 검증한다
    expect(openai.calls.length + anthropic.calls.length).toBe(40);
    expect(openai.calls.length).toBeGreaterThan(anthropic.calls.length);

    const [experiment] = (await service.experiments()).experiments;
    expect(experiment).toMatchObject({
      feature: "product-analysis",
      env: "LLM_EXPERIMENT_ANALYSIS",
      active: true,
      assignments: 40,
    });
    const total = experiment.variants.reduce(
      (sum, variant) => sum + variant.assignments,
      0,
    );
    expect(total).toBe(40);
    expect(
      experiment.variants.map((variant) => [variant.key, variant.weightShare]),
    ).toEqual([
      ["openai", 0.75],
      ["anthropic", 0.25],
    ]);
  });

  it("A/B Routing — 변형별 모델이 호출과 Execution에 그대로 반영된다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS =
      "ab-4o-vs-sonnet|ab|openai:gpt-4o-mini=1,anthropic:claude-sonnet-5=1";
    const { service, openai, anthropic, executions } = createService();

    for (let i = 0; i < 30; i += 1) {
      await service.complete(
        { messages: MESSAGES },
        { feature: "product-analysis" },
      );
    }

    // 각 변형은 자기 모델로만 호출된다
    expect(new Set(openai.calls)).toEqual(new Set(["gpt-4o-mini"]));
    expect(new Set(anthropic.calls)).toEqual(new Set(["claude-sonnet-5"]));
    // Execution에도 변형별 provider/model이 남아 비교 지표의 원천이 된다
    const pairs = new Set(
      executions.map((entry) => `${entry.provider}:${entry.model}`),
    );
    expect([...pairs].sort()).toEqual([
      "anthropic:claude-sonnet-5",
      "openai:gpt-4o-mini",
    ]);

    const [experiment] = (await service.experiments()).experiments;
    expect(experiment).toMatchObject({ name: "ab-4o-vs-sonnet", kind: "ab" });
    for (const variant of experiment.variants) {
      expect(variant.actualShare).toBeGreaterThan(0);
    }
  });

  it("Canary Routing — 소수 변형에만 일부 트래픽이 간다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS =
      "sonnet-canary|canary|openai=99,anthropic=1";
    const { service, openai } = createService();

    for (let i = 0; i < 50; i += 1) {
      await service.complete(
        { messages: MESSAGES },
        { feature: "product-analysis" },
      );
    }

    // 99:1이므로 대다수가 baseline으로 간다
    expect(openai.calls.length).toBeGreaterThanOrEqual(40);
    const [experiment] = (await service.experiments()).experiments;
    expect(experiment.kind).toBe("canary");
    expect(experiment.variants[1]).toMatchObject({
      key: "anthropic",
      weightShare: 0.01,
    });
  });

  it("Weighted Routing — 사용 불가 변형은 제외하고 재정규화한다", async () => {
    // gemini는 인스턴스가 없다 (키 미설정)
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=50,gemini=50";
    const { service, openai, anthropic } = createService();

    for (let i = 0; i < 10; i += 1) {
      await service.complete(
        { messages: MESSAGES },
        { feature: "product-analysis" },
      );
    }

    expect(openai.calls).toHaveLength(10); // 전부 openai로
    expect(anthropic.calls).toHaveLength(0);

    const [experiment] = (await service.experiments()).experiments;
    expect(experiment.active).toBe(true);
    expect(experiment.variants).toEqual([
      expect.objectContaining({ key: "openai", effectiveShare: 1 }),
      expect.objectContaining({
        key: "gemini",
        available: false,
        effectiveShare: 0,
      }),
    ]);
    expect(experiment.reason).toContain("gemini");
  });

  it("실험 미설정이면 기존 라우팅 그대로 (기본 동작 유지)", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    const { service, openai, anthropic } = createService();

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );

    expect(result.provider).toBe("anthropic");
    expect(anthropic.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(0);
    expect((await service.experiments()).experiments).toEqual([]);
  });

  it("전 변형을 쓸 수 없으면 실험을 적용하지 않고 라우팅으로 처리한다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "gemini=50,cohere=50";
    process.env.LLM_ROUTE_ANALYSIS = "anthropic";
    const { service, anthropic } = createService();

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );

    expect(result.provider).toBe("anthropic");
    expect(anthropic.calls).toHaveLength(1);
    const [experiment] = (await service.experiments()).experiments;
    expect(experiment.active).toBe(false);
    expect(experiment.reason).toContain("기존 라우팅");
  });

  it("실험 변형이 실패하면 Failover 체인이 그대로 동작한다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    process.env.LLM_FAILOVER_PRIORITY = "anthropic";
    const { service, openai, executions } = createService({
      openaiFails: true,
    });

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );

    // 변형(openai) 실패 → 우선순위(anthropic)로 전환
    expect(openai.calls).toHaveLength(1);
    expect(result.provider).toBe("anthropic");
    expect(executions.map((entry) => `${entry.provider}:${entry.status}`)).toEqual(
      ["openai:FAILED", "anthropic:SUCCESS"],
    );
  });

  it("호출자가 지정한 모델은 실험 변형 모델보다 우선한다", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai:gpt-4o=100";
    const { service, openai } = createService();

    await service.complete(
      { messages: MESSAGES, model: "gpt-4o-mini" },
      { feature: "product-analysis" },
    );

    expect(openai.calls).toEqual(["gpt-4o-mini"]);
  });

  it("Health Check는 실험 배정을 받지 않는다 (진단 경로)", async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS = "openai=100";
    const { service, openai } = createService();

    // 실험이 걸린 feature와 무관하게, 지정한 Provider만 점검한다
    const result = await service.health("anthropic");

    expect(result.provider).toBe("anthropic");
    expect(openai.calls).toHaveLength(0);
    expect((await service.experiments()).experiments[0].assignments).toBe(0);
  });
});
