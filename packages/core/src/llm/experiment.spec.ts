import {
  describeExperiment,
  parseExperiment,
  pickVariant,
  variantKey,
} from "./experiment";

describe("Routing Experiment (TASK-1003)", () => {
  describe("parseExperiment", () => {
    it("Percentage — 가중치만 있는 최소 형식을 해석한다", () => {
      const experiment = parseExperiment(
        "product-analysis",
        "openai=90,anthropic=10",
      );
      expect(experiment).toMatchObject({
        feature: "product-analysis",
        name: "product-analysis",
        kind: "canary", // 한쪽이 10% 이하 → Canary로 추정
      });
      expect(experiment?.variants).toEqual([
        { provider: "openai", model: null, weight: 90 },
        { provider: "anthropic", model: null, weight: 10 },
      ]);
    });

    it("A/B — 이름·종류·모델 지정을 해석한다", () => {
      const experiment = parseExperiment(
        "content-generation",
        "ab-4o-vs-sonnet|ab|openai:gpt-4o=50,anthropic:claude-sonnet-5=50",
      );
      expect(experiment).toMatchObject({ name: "ab-4o-vs-sonnet", kind: "ab" });
      expect(experiment?.variants).toEqual([
        { provider: "openai", model: "gpt-4o", weight: 50 },
        { provider: "anthropic", model: "claude-sonnet-5", weight: 50 },
      ]);
    });

    it("Canary — 종류를 명시하면 추정보다 우선한다", () => {
      const experiment = parseExperiment(
        "product-analysis",
        "sonnet-canary|canary|openai=95,anthropic=5",
      );
      expect(experiment).toMatchObject({ name: "sonnet-canary", kind: "canary" });
    });

    it("Weighted — 3종 이상은 weighted로 추정한다", () => {
      const experiment = parseExperiment(
        "vision-analysis",
        "openai=60,anthropic=30,gemini=10",
      );
      expect(experiment?.kind).toBe("weighted");
      expect(experiment?.variants).toHaveLength(3);
    });

    it("가중치를 생략하면 균등 분배로 본다", () => {
      const experiment = parseExperiment("product-analysis", "openai,anthropic");
      expect(experiment?.variants).toEqual([
        { provider: "openai", model: null, weight: 1 },
        { provider: "anthropic", model: null, weight: 1 },
      ]);
      expect(experiment?.kind).toBe("ab");
    });

    it("빈 값·잘못된 가중치는 무시한다", () => {
      expect(parseExperiment("product-analysis", "")).toBeNull();
      expect(parseExperiment("product-analysis", "   ")).toBeNull();
      expect(parseExperiment("product-analysis", "=10,  ")).toBeNull();
      // 음수·0·문자 가중치 변형만 버리고 나머지는 살린다
      const experiment = parseExperiment(
        "product-analysis",
        "openai=0,anthropic=abc,gemini=5",
      );
      expect(experiment?.variants).toEqual([
        { provider: "gemini", model: null, weight: 5 },
      ]);
    });
  });

  describe("pickVariant", () => {
    const variants = [
      { provider: "openai", model: null, weight: 90 },
      { provider: "anthropic", model: null, weight: 10 },
    ];

    it("가중치 구간에 따라 배정한다", () => {
      const available = ["openai", "anthropic"];
      expect(
        pickVariant(variants, { availableProviders: available, random: () => 0 }),
      ).toMatchObject({ key: "openai", share: 0.9 });
      expect(
        pickVariant(variants, {
          availableProviders: available,
          random: () => 0.89,
        })?.key,
      ).toBe("openai");
      expect(
        pickVariant(variants, {
          availableProviders: available,
          random: () => 0.9,
        }),
      ).toMatchObject({ key: "anthropic", share: 0.1 });
      expect(
        pickVariant(variants, {
          availableProviders: available,
          random: () => 0.999999,
        })?.key,
      ).toBe("anthropic");
    });

    it("사용 불가 변형은 제외하고 가중치를 재정규화한다", () => {
      // anthropic만 가능 → 추첨 결과와 무관하게 anthropic, 배정 확률 100%
      const picked = pickVariant(variants, {
        availableProviders: ["anthropic"],
        random: () => 0,
      });
      expect(picked).toMatchObject({ key: "anthropic", share: 1 });
    });

    it("사용 가능한 변형이 없으면 null (기존 라우팅으로 처리)", () => {
      expect(
        pickVariant(variants, { availableProviders: ["mock"], random: () => 0 }),
      ).toBeNull();
      expect(pickVariant([], { availableProviders: ["openai"] })).toBeNull();
    });

    it("분포가 가중치를 따른다 (결정적 스윕)", () => {
      const counts: Record<string, number> = { openai: 0, anthropic: 0 };
      for (let i = 0; i < 1000; i += 1) {
        const picked = pickVariant(variants, {
          availableProviders: ["openai", "anthropic"],
          random: () => i / 1000,
        });
        counts[picked!.variant.provider] += 1;
      }
      expect(counts).toEqual({ openai: 900, anthropic: 100 });
    });

    it("모델 지정 변형은 provider:model 키를 갖는다", () => {
      const picked = pickVariant(
        [{ provider: "openai", model: "gpt-4o-mini", weight: 1 }],
        { availableProviders: ["openai"], random: () => 0.5 },
      );
      expect(picked?.key).toBe("openai:gpt-4o-mini");
      expect(variantKey({ provider: "mock", model: null })).toBe("mock");
    });
  });

  describe("describeExperiment", () => {
    it("설정 비율과 실제 배정 비율을 함께 계산한다", () => {
      const experiment = parseExperiment(
        "product-analysis",
        "canary|openai=90,anthropic=10",
      )!;
      const view = describeExperiment(experiment, ["openai"]);
      expect(view.active).toBe(true);
      expect(view.env).toBe("LLM_EXPERIMENT_ANALYSIS");
      expect(view.variants).toEqual([
        expect.objectContaining({
          key: "openai",
          weightShare: 0.9,
          available: true,
          effectiveShare: 1,
        }),
        expect.objectContaining({
          key: "anthropic",
          weightShare: 0.1,
          available: false,
          effectiveShare: 0,
        }),
      ]);
      expect(view.reason).toContain("anthropic");
    });

    it("전부 사용 불가면 비활성 + 사유", () => {
      const experiment = parseExperiment("vision-analysis", "openai=1,gemini=1")!;
      const view = describeExperiment(experiment, ["mock"]);
      expect(view.active).toBe(false);
      expect(view.reason).toContain("기존 라우팅");
    });
  });
});
