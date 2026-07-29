import {
  MONITOR_DEFAULTS,
  monitorProduction,
  percentile,
  resolveMonitorOptions,
} from "./production-monitor";
import type { MonitorSample } from "./production-monitor";

function sample(overrides: Partial<MonitorSample> = {}): MonitorSample {
  return {
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-4o",
    success: overrides.success ?? true,
    latencyMs: overrides.latencyMs !== undefined ? overrides.latencyMs : 1000,
    cost: overrides.cost !== undefined ? overrides.cost : 0.001,
    createdAt: overrides.createdAt ?? "2026-07-28T00:00:00.000Z",
  };
}

function many(count: number, overrides: Partial<MonitorSample> = {}) {
  return Array.from({ length: count }, () => sample(overrides));
}

describe("Production Monitoring (TASK-1301)", () => {
  describe("percentile", () => {
    it("최근접 순위 — 관측되지 않은 값을 지어내지 않는다", () => {
      const sorted = [10, 20, 30, 40];
      expect(percentile(sorted, 0.5)).toBe(20);
      expect(percentile(sorted, 0.95)).toBe(40);
      expect(percentile(sorted, 0.99)).toBe(40);
      expect(percentile([], 0.5)).toBe(0);
      expect(percentile([7], 0.99)).toBe(7);
    });
  });

  it("Provider별 성공률·지연 분포·비용을 계산한다", () => {
    const result = monitorProduction([
      ...many(9, { latencyMs: 1000, cost: 0.002 }),
      sample({ success: false, latencyMs: 30_000, cost: null }),
    ]);

    const openai = result.providers.find((row) => row.provider === "openai")!;
    expect(openai.calls).toBe(10);
    expect(openai.successCount).toBe(9);
    expect(openai.failedCount).toBe(1);
    expect(openai.successRate).toBe(0.9);
    expect(openai.latency).toMatchObject({ p50: 1000, max: 30_000 });
    expect(openai.cost).toBeCloseTo(0.018, 6);
    expect(openai.costPerCall).toBeCloseTo(0.002, 6);
    // 실패 호출의 비용 null은 "미산정"으로 세지 않는다 — 경보가 늘 울린다
    expect(openai.unpricedCalls).toBe(0);
  });

  it("표본이 적으면 판정하지 않는다 (unknown)", () => {
    const result = monitorProduction([sample({ success: false })]);
    expect(result.providers[0].status).toBe("unknown");
    expect(result.alerts).toEqual([]);
    expect(result.status).toBe("unknown");
  });

  it("성공률이 기준 아래면 degraded, 절반 아래면 down", () => {
    const degraded = monitorProduction([
      ...many(8, { success: true }),
      ...many(2, { success: false }),
    ]);
    expect(degraded.providers[0].status).toBe("degraded");
    expect(degraded.alerts[0]).toMatchObject({
      level: "warning",
      provider: "openai",
    });
    expect(degraded.status).toBe("degraded");

    const down = monitorProduction(many(10, { success: false }));
    expect(down.providers[0].status).toBe("down");
    expect(down.alerts[0].level).toBe("critical");
    expect(down.alerts[0].message).toContain("사용할 수 없는 상태");
  });

  it("p95 지연이 기준을 넘으면 경고한다", () => {
    const result = monitorProduction(many(10, { latencyMs: 25_000 }));
    expect(result.providers[0].status).toBe("healthy"); // 성공률은 정상
    const alert = result.alerts.find((entry) =>
      entry.message.includes("p95 지연"),
    )!;
    expect(alert.level).toBe("warning");
  });

  it("성공했는데 비용이 없으면 예산 상한 무력화로 경고한다", () => {
    const result = monitorProduction(
      many(10, { model: "gpt-5-preview", cost: null }),
    );
    expect(result.providers[0].unpricedCalls).toBe(10);
    expect(result.providers[0].cost).toBeNull();
    expect(
      result.alerts.find((entry) => entry.message.includes("예산 상한")),
    ).toBeDefined();
  });

  it("여러 Provider를 호출 수 내림차순으로 보고하고, 전체 상태는 최악을 따른다", () => {
    const result = monitorProduction([
      ...many(10, { provider: "openai" }),
      ...many(6, { provider: "anthropic", success: false }),
    ]);
    expect(result.providers.map((row) => row.provider)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(result.status).toBe("down"); // anthropic이 죽었으면 전체는 정상이 아니다
    expect(result.totals).toMatchObject({
      calls: 16,
      successCount: 10,
      failedCount: 6,
    });
  });

  it("모델 목록과 마지막 호출 시각을 함께 제공한다", () => {
    const result = monitorProduction([
      sample({ model: "gpt-4o", createdAt: "2026-07-28T00:00:00.000Z" }),
      sample({ model: "gpt-4o-mini", createdAt: "2026-07-28T01:00:00.000Z" }),
      sample({ model: "gpt-4o", createdAt: "2026-07-27T00:00:00.000Z" }),
    ]);
    expect(result.providers[0].models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(result.providers[0].lastCallAt).toBe("2026-07-28T01:00:00.000Z");
  });

  it("표본이 없으면 unknown — 정상이라고 말하지 않는다", () => {
    const result = monitorProduction([]);
    expect(result.status).toBe("unknown");
    expect(result.providers).toEqual([]);
    expect(result.totals).toMatchObject({ calls: 0, successRate: null, cost: null });
  });

  it("기준값은 조정할 수 있다", () => {
    const result = monitorProduction(
      [...many(8, { success: true }), ...many(2, { success: false })],
      { healthyRate: 0.8, windowMinutes: 15, minSamples: 3 },
    );
    expect(result.providers[0].status).toBe("healthy");
    expect(result.windowMinutes).toBe(15);
    expect(result.minSamples).toBe(3);
  });

  describe("resolveMonitorOptions (CTO 결정 1301-②)", () => {
    it("미설정이면 확정 기본값 — Healthy 95% / Degraded 50% / 최소 표본 5 / p95 20초", () => {
      expect(resolveMonitorOptions({})).toEqual({
        minSamples: 5,
        healthyRate: 0.95,
        degradedRate: 0.5,
        latencyWarnMs: 20_000,
      });
      expect(MONITOR_DEFAULTS.healthyRate).toBe(0.95);
    });

    it("환경변수로 조정할 수 있다", () => {
      expect(
        resolveMonitorOptions({
          LLM_MONITOR_MIN_SAMPLES: "20",
          LLM_MONITOR_HEALTHY_RATE: "0.99",
          LLM_MONITOR_DEGRADED_RATE: "0.8",
          LLM_MONITOR_P95_WARN_MS: "5000",
        }),
      ).toEqual({
        minSamples: 20,
        healthyRate: 0.99,
        degradedRate: 0.8,
        latencyWarnMs: 5_000,
      });
    });

    it("해석할 수 없는 값은 기본값으로 되돌린다", () => {
      expect(
        resolveMonitorOptions({
          LLM_MONITOR_MIN_SAMPLES: "abc",
          LLM_MONITOR_HEALTHY_RATE: "-1",
          LLM_MONITOR_DEGRADED_RATE: "",
          LLM_MONITOR_P95_WARN_MS: "0",
        }),
      ).toEqual({
        minSamples: 5,
        healthyRate: 0.95,
        degradedRate: 0.5,
        latencyWarnMs: 20_000,
      });
      // 비율이 1을 넘으면 성립할 수 없는 기준이다
      expect(
        resolveMonitorOptions({ LLM_MONITOR_HEALTHY_RATE: "95" }).healthyRate,
      ).toBe(0.95);
    });

    it("순서가 뒤집힌 기준은 둘 다 기본값으로 — 이상한 기준으로 조용히 판정하지 않는다", () => {
      const resolved = resolveMonitorOptions({
        LLM_MONITOR_HEALTHY_RATE: "0.5",
        LLM_MONITOR_DEGRADED_RATE: "0.9",
      });
      expect(resolved.healthyRate).toBe(0.95);
      expect(resolved.degradedRate).toBe(0.5);
    });

    it("해석된 기준이 실제 판정에 적용된다", () => {
      const options = resolveMonitorOptions({
        LLM_MONITOR_HEALTHY_RATE: "0.8",
        LLM_MONITOR_MIN_SAMPLES: "3",
      });
      const result = monitorProduction(
        [...many(8, { success: true }), ...many(2, { success: false })],
        options,
      );
      expect(result.providers[0].status).toBe("healthy"); // 80% 기준이면 정상
      expect(result.minSamples).toBe(3);
    });
  });
});
