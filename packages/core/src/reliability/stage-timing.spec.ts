import {
  analyzeStageTrend,
  PERF_MIN_SAMPLE,
  summarizePerf,
  type StageMetric,
} from "./stage-timing";

function stage(overrides: Partial<StageMetric> & { stage: string }): StageMetric {
  return {
    stage: overrides.stage,
    durationMs: overrides.durationMs ?? 100,
    tokens: overrides.tokens === undefined ? null : overrides.tokens,
    processHeapDeltaBytes:
      overrides.processHeapDeltaBytes === undefined ? null : overrides.processHeapDeltaBytes,
    ok: overrides.ok ?? true,
  };
}

describe("summarizePerf (TASK-4603)", () => {
  it("가장 오래 걸린 단계를 지목한다", () => {
    const report = summarizePerf({
      stages: [
        stage({ stage: "fetch", durationMs: 50 }),
        stage({ stage: "ocr", durationMs: 800 }),
        stage({ stage: "save", durationMs: 20 }),
      ],
      totalMs: 900,
    });
    expect(report.slowest?.stage).toBe("ocr");
    expect(report.detail).toContain("가장 오래 걸린 단계");
    expect(report.detail).toContain("89%");
  });

  /**
   * 안 잰 시간을 감추면 "단계는 다 빠른데 전체는 느린" 상태를 설명할 수 없다.
   */
  it("단계 밖에서 지난 시간을 감추지 않는다", () => {
    const report = summarizePerf({
      stages: [stage({ stage: "a", durationMs: 100 })],
      totalMs: 500,
    });
    expect(report.measuredMs).toBe(100);
    expect(report.unmeasuredMs).toBe(400);
    expect(report.detail).toContain("재지 않았습니다");
  });

  /**
   * 모르는 값을 0으로 적으면 합계가 실제보다 작아지고, 그 합계로 비용을
   * 재면 청구서와 어긋난다 (3001의 규칙과 같음).
   */
  it("토큰을 모르는 단계가 있으면 합계를 내지 않는다", () => {
    const report = summarizePerf({
      stages: [
        stage({ stage: "a", tokens: { input: 100, output: 50 } }),
        stage({ stage: "b", tokens: { input: null, output: 20 } }),
      ],
      totalMs: 200,
    });
    expect(report.tokens.input).toBeNull();
    expect(report.tokens.output).toBe(70);
    expect(report.detail).toContain("0으로 채우면");
  });

  it("전부 알면 합계를 낸다", () => {
    const report = summarizePerf({
      stages: [
        stage({ stage: "a", tokens: { input: 100, output: 50 } }),
        stage({ stage: "b", tokens: { input: 10, output: 5 } }),
      ],
      totalMs: 200,
    });
    expect(report.tokens).toEqual({ input: 110, output: 55 });
  });

  it("토큰을 쓰지 않는 작업이면 null이다 — 0이 아니다", () => {
    const report = summarizePerf({ stages: [stage({ stage: "a" })], totalMs: 100 });
    expect(report.tokens).toEqual({ input: null, output: null });
  });

  it("단계가 없어도 터지지 않는다", () => {
    const report = summarizePerf({ stages: [], totalMs: 0 });
    expect(report.slowest).toBeNull();
    expect(report.detail).not.toContain("**");
  });

  /**
   * 프로세스 전체 값을 이 작업의 것이라고 말하면 아무도 다시 확인하지 않는다.
   */
  it("메모리 칸의 이름이 프로세스 값임을 밝힌다", () => {
    const metric = stage({ stage: "a", processHeapDeltaBytes: 1024 });
    expect(Object.keys(metric)).toContain("processHeapDeltaBytes");
    expect(Object.keys(metric)).not.toContain("memoryUsedBytes");
  });
});

describe("analyzeStageTrend (TASK-4603)", () => {
  /**
   * 한 번 느렸던 것을 "느린 단계"로 적으면, 그날 네트워크가 흔들린 것이
   * 영구 결함으로 남는다 (4401-②와 같은 규칙).
   */
  it("표본이 적으면 판정하지 않는다", () => {
    const trend = analyzeStageTrend({
      stage: "ocr",
      durations: [9000, 9500],
      thresholdMs: 1000,
    });
    expect(trend.verdict).toBe("insufficient");
    expect(trend.detail).toContain("빠르다는 뜻도 느리다는 뜻도 아닙니다");
    expect(PERF_MIN_SAMPLE).toBe(5);
  });

  it("표본이 충분하고 중앙값이 기준을 넘으면 느리다고 본다", () => {
    const trend = analyzeStageTrend({
      stage: "ocr",
      durations: [1200, 1300, 1400, 1500, 1600],
      thresholdMs: 1000,
    });
    expect(trend.verdict).toBe("slow");
    expect(trend.medianMs).toBe(1400);
  });

  /**
   * 평균을 쓰면 한 번의 큰 값이 판정을 끌고 간다.
   */
  it("평균이 아니라 중앙값으로 본다", () => {
    const trend = analyzeStageTrend({
      stage: "ocr",
      durations: [100, 100, 100, 100, 100_000],
      thresholdMs: 1000,
    });
    expect(trend.medianMs).toBe(100);
    expect(trend.verdict).toBe("ok");
    // 그래도 꼬리는 보여 준다
    expect(trend.p95Ms).toBe(100_000);
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const durations of [[], [1], [1, 2, 3, 4, 5]]) {
      expect(
        analyzeStageTrend({ stage: "a", durations, thresholdMs: 10 }).detail,
      ).not.toContain("**");
    }
  });
});
