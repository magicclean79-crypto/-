import {
  analyzeExperiment,
  normalCdf,
  proportionConfidence,
  recommendWinner,
  wilsonInterval,
} from "./experiment-analytics";
import type { VariantSample } from "./experiment-analytics";

function sample(
  key: string,
  overrides: Partial<VariantSample> = {},
): VariantSample {
  const calls = overrides.calls ?? 100;
  const successes = overrides.successes ?? calls;
  return {
    key,
    provider: key.split(":")[0],
    model: key.includes(":") ? key.split(":")[1] : null,
    calls,
    successes,
    failures: calls - successes,
    avgLatencyMs: 500,
    cost: 1,
    inputTokens: 1000,
    outputTokens: 300,
    ...overrides,
  };
}

describe("Experiment Analytics & Recommendation (TASK-1102)", () => {
  describe("통계 도구", () => {
    it("normalCdf — 표준정규 누적분포 기준값", () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 6);
      expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
      expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
      expect(normalCdf(3)).toBeCloseTo(0.9987, 3);
    });

    it("wilsonInterval — 표본이 작으면 구간이 넓다 (과신 방지)", () => {
      const small = wilsonInterval(3, 3)!;
      // 3/3 성공이어도 하한이 1이 아니다
      expect(small[0]).toBeLessThan(0.6);
      expect(small[1]).toBeCloseTo(1, 1);

      const large = wilsonInterval(300, 300)!;
      expect(large[0]).toBeGreaterThan(0.98);
      expect(wilsonInterval(0, 0)).toBeNull();
    });

    it("proportionConfidence — 차이가 클수록·표본이 클수록 신뢰도가 높다", () => {
      const weak = proportionConfidence(
        { successes: 6, total: 10 },
        { successes: 5, total: 10 },
      );
      const strong = proportionConfidence(
        { successes: 600, total: 1000 },
        { successes: 500, total: 1000 },
      );
      expect(weak).toBeLessThan(0.5);
      expect(strong).toBeGreaterThan(0.99);
      expect(strong).toBeGreaterThan(weak);
    });

    it("proportionConfidence — 동일 비율이거나 표본이 없으면 0", () => {
      // erf 근사 오차(~1e-9)까지만 허용 — 사실상 0
      expect(
        proportionConfidence(
          { successes: 50, total: 100 },
          { successes: 50, total: 100 },
        ),
      ).toBeCloseTo(0, 6);
      expect(
        proportionConfidence({ successes: 0, total: 0 }, { successes: 1, total: 2 }),
      ).toBe(0);
    });
  });

  describe("analyzeExperiment", () => {
    it("변형별 성공률·호출당 비용·신뢰구간을 계산한다", () => {
      const result = analyzeExperiment({
        samples: [
          sample("openai", { calls: 100, successes: 95, cost: 2 }),
          sample("anthropic", { calls: 50, successes: 40, cost: 1.5 }),
        ],
        weightShares: { openai: 0.9, anthropic: 0.1 },
      });

      expect(result.totalCalls).toBe(150);
      expect(result.variants[0]).toMatchObject({
        key: "openai",
        successRate: 0.95,
        costPerCall: 0.02,
        weightShare: 0.9,
      });
      expect(result.variants[1].successRate).toBe(0.8);
      expect(result.variants[1].costPerCall).toBe(0.03);
      expect(result.variants[0].successRateInterval![0]).toBeGreaterThan(0.85);
    });

    it("가중치가 가장 큰 변형이 비교 기준(baseline)이 된다", () => {
      const result = analyzeExperiment({
        samples: [
          sample("anthropic", { calls: 40, successes: 30 }),
          sample("openai", { calls: 200, successes: 190 }),
        ],
        weightShares: { openai: 0.8, anthropic: 0.2 },
      });
      expect(result.baseline).toBe("openai");
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].key).toBe("anthropic");
    });

    it("기준 대비 성공률·지연·비용 차이를 계산한다", () => {
      const result = analyzeExperiment({
        samples: [
          sample("openai", {
            calls: 100,
            successes: 90,
            avgLatencyMs: 800,
            cost: 2,
          }),
          sample("anthropic", {
            calls: 100,
            successes: 95,
            avgLatencyMs: 500,
            cost: 1,
          }),
        ],
        weightShares: { openai: 0.5, anthropic: 0.5 },
      });
      const [comparison] = result.comparisons;
      expect(comparison.successRateDelta).toBeCloseTo(0.05, 6);
      expect(comparison.latencyDelta).toBe(-300); // 더 빠름
      expect(comparison.costPerCallDelta).toBeCloseTo(-0.01, 6); // 더 저렴
    });

    it("비용이 없는 변형(가격표 미등록)은 호출당 비용이 null", () => {
      const result = analyzeExperiment({
        samples: [sample("mock", { cost: null })],
      });
      expect(result.variants[0].costPerCall).toBeNull();
    });

    it("변형이 없으면 추천하지 않는다", () => {
      const result = analyzeExperiment({ samples: [] });
      expect(result.recommendation).toMatchObject({
        winner: null,
        basis: "no-variants",
        conclusive: false,
      });
    });
  });

  describe("recommendWinner", () => {
    const perf = (input: VariantSample[]) =>
      analyzeExperiment({ samples: input }).variants;

    it("표본이 모자라면 추천하지 않는다 (근거 없는 추천 금지)", () => {
      const recommendation = recommendWinner(
        perf([
          sample("openai", { calls: 100, successes: 100 }),
          sample("anthropic", { calls: 5, successes: 2 }),
        ]),
      );
      expect(recommendation).toMatchObject({
        winner: null,
        basis: "insufficient-data",
        conclusive: false,
      });
      expect(recommendation.reason).toContain("anthropic 5회");
    });

    it("성공률 차이가 유의하면 그 변형이 승자 (품질 우선)", () => {
      // 비용은 openai가 비싸지만 성공률이 확실히 높다
      const recommendation = recommendWinner(
        perf([
          sample("openai", { calls: 500, successes: 490, cost: 50 }),
          sample("anthropic", { calls: 500, successes: 400, cost: 5 }),
        ]),
      );
      expect(recommendation).toMatchObject({
        winner: "openai",
        basis: "success-rate",
        conclusive: true,
      });
      expect(recommendation.confidence).toBeGreaterThan(0.95);
      expect(recommendation.reason).toContain("성공률");
    });

    it("성공률이 통계적으로 같으면 호출당 비용이 싼 쪽", () => {
      const recommendation = recommendWinner(
        perf([
          sample("openai", { calls: 200, successes: 190, cost: 20 }),
          sample("anthropic", { calls: 200, successes: 189, cost: 4 }),
        ]),
      );
      expect(recommendation).toMatchObject({
        winner: "anthropic",
        basis: "cost",
        // 통계적으로 확정은 아니다 — 비용 근거임을 명확히 한다
        conclusive: false,
      });
      expect(recommendation.reason).toContain("비용");
    });

    it("성공률·비용이 같으면 지연이 짧은 쪽", () => {
      const recommendation = recommendWinner(
        perf([
          sample("openai", {
            calls: 200,
            successes: 190,
            cost: 10,
            avgLatencyMs: 900,
          }),
          sample("anthropic", {
            calls: 200,
            successes: 190,
            cost: 10,
            avgLatencyMs: 400,
          }),
        ]),
      );
      expect(recommendation).toMatchObject({
        winner: "anthropic",
        basis: "latency",
        conclusive: false,
      });
    });

    it("어느 축에서도 차이가 없으면 추천을 보류한다", () => {
      const recommendation = recommendWinner(
        perf([
          sample("openai", {
            calls: 200,
            successes: 190,
            cost: 10,
            avgLatencyMs: 500,
          }),
          sample("anthropic", {
            calls: 200,
            successes: 190,
            cost: 10,
            avgLatencyMs: 500,
          }),
        ]),
      );
      expect(recommendation.winner).toBeNull();
      expect(recommendation.conclusive).toBe(false);
      expect(recommendation.reason).toContain("뚜렷하지 않");
    });

    it("변형이 하나면 비교 대상이 없다고 알린다", () => {
      const recommendation = recommendWinner(
        perf([sample("openai", { calls: 500 })]),
      );
      expect(recommendation).toMatchObject({
        winner: "openai",
        basis: "insufficient-data",
        conclusive: false,
      });
    });

    it("최소 표본 기준은 조정할 수 있다", () => {
      const variants = perf([
        sample("openai", { calls: 10, successes: 10, cost: 1 }),
        sample("anthropic", { calls: 10, successes: 3, cost: 1 }),
      ]);
      expect(recommendWinner(variants).basis).toBe("insufficient-data");
      expect(recommendWinner(variants, 5)).toMatchObject({
        winner: "openai",
        basis: "success-rate",
      });
    });
  });
});
