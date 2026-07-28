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
