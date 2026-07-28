import { HttpException, HttpStatus } from "@nestjs/common";
import { markNoFailover, MockLlmProvider } from "@acos/core";
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
 * Provider Failover Engine 검증. (TASK-1002, Sprint 10)
 *
 * 실행 중 오류가 나면 우선순위에 따라 다음 Provider로 넘기고, 각 시도가
 * Execution으로 남는지(Failover Metrics 원천) 확인한다.
 * **Budget 초과·Validation 오류는 Failover 대상이 아니다** (CTO 지시).
 */

class FlakyProvider implements LlmProvider {
  calls = 0;
  constructor(
    readonly name: string,
    readonly defaultModel: string,
    private readonly behavior: "ok" | "fail" | "hang",
  ) {}
  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls += 1;
    if (this.behavior === "fail") {
      throw new Error(`${this.name} 503 Service Unavailable`);
    }
    if (this.behavior === "hang") {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
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

describe("Provider Failover Engine (TASK-1002)", () => {
  const ENVS = [
    "LLM_FAILOVER_PRIORITY",
    "LLM_TIMEOUT_MS",
    "LLM_MAX_ATTEMPTS",
    "LLM_ROUTE_ANALYSIS",
    "LLM_FAILOVER_HEALTH_THRESHOLD",
  ];

  beforeEach(() => {
    // 재시도 없이 곧바로 Failover되도록 (테스트 시간 단축)
    process.env.LLM_MAX_ATTEMPTS = "1";
  });

  afterEach(() => {
    for (const env of ENVS) {
      delete process.env[env];
    }
  });

  function createService(
    behaviors: {
      openai?: "ok" | "fail" | "hang";
      anthropic?: "ok" | "fail" | "hang";
    } = {},
  ) {
    const mock = new MockLlmProvider();
    const openai = new FlakyProvider(
      "openai",
      "gpt-4o",
      behaviors.openai ?? "ok",
    );
    const anthropic = new FlakyProvider(
      "anthropic",
      "claude-opus-5",
      behaviors.anthropic ?? "ok",
    );
    const { store, executions } = createStore();
    const budget = {
      assertWithinBudget: jest.fn(async () => undefined),
    };
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
    return { service, openai, anthropic, executions, budget };
  }

  it("1순위 실패 → 우선순위 다음 Provider로 Failover하고 각 시도가 Execution에 남는다", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai";
    process.env.LLM_FAILOVER_PRIORITY = "anthropic,mock";
    const { service, openai, anthropic, executions } = createService({
      openai: "fail",
    });

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );

    expect(result.provider).toBe("anthropic");
    expect(openai.calls).toBe(1);
    expect(anthropic.calls).toBe(1);
    // Failover Metrics 원천: 실패한 시도와 성공한 시도가 모두 기록된다
    expect(
      executions.map((entry) => `${entry.provider}:${entry.status}`),
    ).toEqual(["openai:FAILED", "anthropic:SUCCESS"]);

    const failover = service.failover();
    expect(failover.enabled).toBe(true);
    expect(failover.metrics).toMatchObject({
      attempts: 2,
      failovers: 1,
      exhausted: 0,
      skipped: 0,
    });
    expect(failover.metrics.byProvider).toEqual(
      expect.arrayContaining([
        { provider: "openai", success: 0, failed: 1 },
        { provider: "anthropic", success: 1, failed: 0 },
      ]),
    );
  });

  it("우선순위 미설정이면 Failover하지 않고 그대로 실패한다 (기본 동작 유지)", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai";
    const { service, anthropic, executions } = createService({
      openai: "fail",
    });

    await expect(
      service.complete({ messages: MESSAGES }, { feature: "product-analysis" }),
    ).rejects.toThrow("503");
    expect(anthropic.calls).toBe(0);
    expect(executions).toHaveLength(1);
    expect(service.failover()).toMatchObject({
      enabled: false,
      metrics: expect.objectContaining({ failovers: 0, exhausted: 1 }),
    });
  });

  it("Timeout Policy — 응답이 없으면 시간 초과로 다음 Provider로 넘긴다", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai";
    process.env.LLM_FAILOVER_PRIORITY = "anthropic";
    process.env.LLM_TIMEOUT_MS = "50";
    const { service, executions } = createService({ openai: "hang" });

    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );
    expect(result.provider).toBe("anthropic");
    expect(executions[0]).toMatchObject({
      provider: "openai",
      status: "FAILED",
    });
    expect(executions[0].error).toContain("50ms");
  });

  it("Budget 초과는 Failover 대상이 아니다 — 즉시 429, 호출 시도 없음", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai";
    process.env.LLM_FAILOVER_PRIORITY = "anthropic";
    const { service, openai, anthropic, executions, budget } = createService();
    budget.assertWithinBudget.mockRejectedValueOnce(
      markNoFailover(
        new HttpException("예산 초과", HttpStatus.TOO_MANY_REQUESTS),
      ),
    );

    await expect(
      service.complete({ messages: MESSAGES }, { feature: "product-analysis" }),
    ).rejects.toMatchObject({ status: 429 });
    expect(openai.calls).toBe(0);
    expect(anthropic.calls).toBe(0);
    expect(executions).toHaveLength(0);
  });

  it("Validation 오류는 Failover 대상이 아니다 — 400, Execution 미기록", async () => {
    process.env.LLM_FAILOVER_PRIORITY = "anthropic,openai";
    const { service, openai, anthropic, executions } = createService();

    await expect(
      service.complete({ messages: [] }, { feature: "product-analysis" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(openai.calls).toBe(0);
    expect(anthropic.calls).toBe(0);
    expect(executions).toHaveLength(0);
  });

  it("체인을 모두 소진하면 마지막 오류로 실패한다", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai";
    process.env.LLM_FAILOVER_PRIORITY = "anthropic";
    const { service, executions } = createService({
      openai: "fail",
      anthropic: "fail",
    });

    await expect(
      service.complete({ messages: MESSAGES }, { feature: "product-analysis" }),
    ).rejects.toThrow("anthropic 503");
    expect(executions.map((entry) => entry.provider)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(service.failover().metrics).toMatchObject({
      failovers: 1,
      exhausted: 1,
    });
  });

  it("Health Check Integration — 연속 실패한 Provider는 체인 뒤로 밀린다", async () => {
    process.env.LLM_ROUTE_ANALYSIS = "openai";
    process.env.LLM_FAILOVER_PRIORITY = "anthropic";
    process.env.LLM_FAILOVER_HEALTH_THRESHOLD = "1";
    const { service, openai, anthropic } = createService({ openai: "fail" });

    // 1회차: openai 실패 → anthropic 성공, openai는 불건강으로 기록
    await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );
    expect(openai.calls).toBe(1);

    const health = service.failover().health;
    expect(health.find((state) => state.provider === "openai")).toMatchObject({
      healthy: false,
      consecutiveFailures: 1,
    });

    // 2회차: 불건강한 openai가 뒤로 밀려 anthropic이 먼저 시도된다
    const result = await service.complete(
      { messages: MESSAGES },
      { feature: "product-analysis" },
    );
    expect(result.provider).toBe("anthropic");
    expect(openai.calls).toBe(1); // 추가 호출 없음
    expect(anthropic.calls).toBe(2);
  });

  it("Health Check는 Failover를 쓰지 않고 대상 Provider를 그대로 점검한다", async () => {
    process.env.LLM_FAILOVER_PRIORITY = "anthropic";
    const { service, anthropic } = createService({ openai: "fail" });

    const result = await service.health("openai");
    expect(result.status).toBe("error");
    expect(result.provider).toBe("openai"); // anthropic으로 넘어가지 않는다
    expect(anthropic.calls).toBe(0);

    // 성공 점검은 건강 상태를 회복시킨다
    const ok = await service.health("anthropic");
    expect(ok.status).toBe("ok");
    expect(
      service.failover().health.find((s) => s.provider === "anthropic"),
    ).toMatchObject({ healthy: true });
  });
});
