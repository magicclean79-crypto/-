import {
  estimateLlmCost,
  ExecutionTracker,
  type ExecutionRecord,
  type ExecutionStore,
  type NewExecution,
} from "./execution";

class InMemoryExecutionStore implements ExecutionStore {
  entries: NewExecution[] = [];

  async record(entry: NewExecution): Promise<ExecutionRecord> {
    this.entries.push(entry);
    return { ...entry, id: `exec-${this.entries.length}`, createdAt: new Date() };
  }
}

/** 호출마다 100ms씩 흐르는 가짜 시계 */
function fakeClock(): () => number {
  let t = 1000;
  return () => (t += 100);
}

describe("estimateLlmCost", () => {
  it("mock 모델은 비용 0", () => {
    expect(
      estimateLlmCost("mock-llm-1", { inputTokens: 500, outputTokens: 200 }),
    ).toBe(0);
  });

  it("가격표에 없는 모델은 null", () => {
    expect(
      estimateLlmCost("unknown-model", { inputTokens: 500, outputTokens: 200 }),
    ).toBeNull();
  });

  it("토큰 사용량이 미상이면 null", () => {
    expect(
      estimateLlmCost("mock-llm-1", { inputTokens: null, outputTokens: 200 }),
    ).toBeNull();
  });

  it("가격표 기준으로 1M 토큰 단가를 계산한다", () => {
    const cost = estimateLlmCost(
      "priced-model",
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      { "priced-model": { inputPerMillion: 2, outputPerMillion: 10 } },
    );
    expect(cost).toBe(7); // 2 + 5
  });

  it("gpt-4o 공식 단가가 등록되어 있다 (TASK-0603)", () => {
    expect(
      estimateLlmCost("gpt-4o", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(12.5); // 2.5 + 10
  });

  it("버전 스냅샷 모델은 최장 접두사로 매칭한다 (gpt-4o-2024-… / gpt-4o-mini-…)", () => {
    expect(
      estimateLlmCost("gpt-4o-2024-08-06", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(2.5);
    // gpt-4o-mini 스냅샷은 gpt-4o가 아니라 더 긴 gpt-4o-mini 단가를 쓴다
    expect(
      estimateLlmCost("gpt-4o-mini-2024-07-18", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(0.15);
  });
});

describe("ExecutionTracker", () => {
  const fallback = { provider: "mock", model: "mock-llm-1" };

  it("성공 시 SUCCESS Execution을 기록하고 결과를 반환한다", async () => {
    const store = new InMemoryExecutionStore();
    const tracker = new ExecutionTracker(store, { now: fakeClock() });

    const result = await tracker.track("content-generation", fallback, async () => ({
      provider: "mock",
      model: "mock-llm-1",
      usage: { inputTokens: 400, outputTokens: 100 },
      text: "본문",
    }));

    expect(result.text).toBe("본문");
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toEqual({
      feature: "content-generation",
      provider: "mock",
      model: "mock-llm-1",
      status: "SUCCESS",
      inputTokens: 400,
      outputTokens: 100,
      cost: 0,
      latencyMs: 100,
      error: null,
      // 일반 호출은 진단이 아니다 (TASK-1302, CTO 결정 1301-③)
      diagnostic: false,
      // 호출 대상 해석기를 주지 않으면 남지 않는다 (TASK-3501, 정책 3501-④)
      endpoint: null,
      baseUrl: null,
      calledAt: expect.any(Date),
      // 요청 추적 해석기를 주지 않으면 남지 않는다 (TASK-3601, 정책 3601-②)
      requestId: null,
      traceId: null,
      // 프로젝트는 부르는 쪽이 알려 준다 (TASK-4301, 정책 4301-②) —
      // 안 알려 주면 null이며 null은 "공용"이 아니라 "모른다"다
      projectId: null,
    });
  });

  /**
   * 이 값은 이미 호출 지점까지 와 있었는데 기록에는 안 남고 있었다 —
   * 그래서 비용표의 귀속률이 0에 가까웠다 (TASK-4301, 정책 4301-②).
   */
  it("부르는 쪽이 프로젝트를 알려 주면 기록에 남는다", async () => {
    const store = new InMemoryExecutionStore();
    const tracker = new ExecutionTracker(store, { now: fakeClock() });

    await tracker.track(
      "product-analysis",
      { provider: "mock", model: "mock-llm-1" },
      async () => ({
        provider: "mock",
        model: "mock-llm-1",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      { projectId: "proj-1" },
    );

    expect(store.entries[0].projectId).toBe("proj-1");
  });

  it("진단 호출은 diagnostic=true로 기록된다 (CTO 결정 1301-③)", async () => {
    const store = new InMemoryExecutionStore();
    const tracker = new ExecutionTracker(store, { now: fakeClock() });

    await tracker.track(
      "dev",
      fallback,
      async () => ({
        provider: "mock",
        model: "mock-llm-1",
        usage: { inputTokens: 4, outputTokens: 2 },
        text: "pong",
      }),
      { diagnostic: true },
    );
    // feature는 그대로 — 4종을 늘리지 않고 메타데이터로만 구분한다
    expect(store.entries[0]).toMatchObject({
      feature: "dev",
      diagnostic: true,
    });

    await expect(
      tracker.track("dev", fallback, async () => {
        throw new Error("ping 실패");
      }, { diagnostic: true }),
    ).rejects.toThrow("ping 실패");
    expect(store.entries[1]).toMatchObject({
      status: "FAILED",
      diagnostic: true,
    });
  });

  it("실패 시 FAILED Execution(폴백 provider/model + 오류)을 기록하고 오류를 다시 던진다", async () => {
    const store = new InMemoryExecutionStore();
    const tracker = new ExecutionTracker(store, { now: fakeClock() });

    await expect(
      tracker.track("product-analysis", fallback, async () => {
        throw new Error("모델 오류");
      }),
    ).rejects.toThrow("모델 오류");

    expect(store.entries[0]).toMatchObject({
      feature: "product-analysis",
      provider: "mock",
      model: "mock-llm-1",
      status: "FAILED",
      cost: null,
      error: "모델 오류",
    });
  });

  it("기록 실패는 호출을 실패시키지 않는다 (onRecordError 훅)", async () => {
    const errors: string[] = [];
    const failingStore: ExecutionStore = {
      record: async () => {
        throw new Error("DB 다운");
      },
    };
    const tracker = new ExecutionTracker(failingStore, {
      now: fakeClock(),
      onRecordError: (message) => errors.push(message),
    });

    const result = await tracker.track("vision-analysis", fallback, async () => ({
      provider: "mock",
      model: "mock-llm-1",
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    expect(result.provider).toBe("mock");
    expect(errors).toEqual(["DB 다운"]);
  });
});

/**
 * 호출 대상·요청 추적 기록 (TASK-3501 정책 3501-④ · TASK-3601 정책 3601-②).
 *
 * core는 환경변수도 요청 컨텍스트도 모른다 — 어댑터가 알려 준다. 주지 않으면
 * **기록에 남지 않고**, 그때 판정은 "모른다"로 센다(공식이었다고 세지 않는다).
 */
describe("ExecutionTracker — 호출 대상과 요청 추적", () => {
  it("어댑터가 알려 주면 그대로 남긴다", async () => {
    const recorded: NewExecution[] = [];
    const tracker = new ExecutionTracker(
      { record: async (entry) => { recorded.push(entry); return { ...entry, id: "x", createdAt: new Date() }; } },
      {
        callTarget: () => ({
          endpoint: "https://api.openai.com/v1/chat/completions",
          baseUrl: "https://api.openai.com",
        }),
        trace: () => ({ requestId: "req-1", traceId: "trace-1" }),
      },
    );

    await tracker.track("dev", { provider: "openai", model: "gpt-4o" }, async () => ({
      provider: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    expect(recorded[0].baseUrl).toBe("https://api.openai.com");
    expect(recorded[0].requestId).toBe("req-1");
    expect(recorded[0].traceId).toBe("trace-1");
    expect(recorded[0].calledAt).toBeInstanceOf(Date);
  });

  it("실패한 호출에도 남긴다 — 실패야말로 추적이 필요하다", async () => {
    const recorded: NewExecution[] = [];
    const tracker = new ExecutionTracker(
      { record: async (entry) => { recorded.push(entry); return { ...entry, id: "x", createdAt: new Date() }; } },
      {
        callTarget: () => ({ endpoint: null, baseUrl: "https://api.openai.com" }),
        trace: () => ({ requestId: "req-2", traceId: "trace-2" }),
      },
    );

    await expect(
      tracker.track("dev", { provider: "openai", model: "gpt-4o" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(recorded[0].status).toBe("FAILED");
    expect(recorded[0].requestId).toBe("req-2");
  });

  it("해석기가 null을 주면 지어내지 않는다", async () => {
    const recorded: NewExecution[] = [];
    const tracker = new ExecutionTracker(
      { record: async (entry) => { recorded.push(entry); return { ...entry, id: "x", createdAt: new Date() }; } },
      { callTarget: () => null, trace: () => null },
    );

    await tracker.track("dev", { provider: "openai", model: "gpt-4o" }, async () => ({
      provider: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    expect(recorded[0].baseUrl).toBeNull();
    expect(recorded[0].requestId).toBeNull();
  });
});
