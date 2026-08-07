import {
  buildRoutingTable,
  parseRoutingRule,
  resolveRoute,
  ROUTABLE_FEATURES,
} from "./routing";

const AVAILABLE = ["mock", "openai", "anthropic"];

describe("Cross-Provider Routing (TASK-1001)", () => {
  it("환경변수 값을 규칙으로 파싱한다 (provider / provider:model)", () => {
    expect(parseRoutingRule("openai")).toEqual({
      provider: "openai",
      model: null,
    });
    expect(parseRoutingRule(" Anthropic : claude-sonnet-5 ")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(parseRoutingRule("")).toBeNull();
    expect(parseRoutingRule(undefined)).toBeNull();
    expect(parseRoutingRule(":model-only")).toBeNull();
  });

  it("매핑이 없으면 기본 Provider (source=default) + 모델 오버라이드 적용", () => {
    const result = resolveRoute({
      feature: "product-analysis",
      defaultProvider: "openai",
      rules: {},
      modelOverrides: { "product-analysis": "gpt-4o-mini" },
      availableProviders: AVAILABLE,
    });
    expect(result).toEqual({
      feature: "product-analysis",
      provider: "openai",
      model: "gpt-4o-mini",
      source: "default",
      reason: null,
    });
  });

  it("feature 매핑이 있으면 해당 Provider로 라우팅한다 (source=feature)", () => {
    const result = resolveRoute({
      feature: "vision-analysis",
      defaultProvider: "openai",
      rules: {
        "vision-analysis": { provider: "anthropic", model: "claude-sonnet-5" },
      },
      availableProviders: AVAILABLE,
    });
    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      source: "feature",
    });
  });

  it("다른 Provider로 라우팅되면 기본 Provider용 모델 오버라이드는 무시한다", () => {
    const result = resolveRoute({
      feature: "product-analysis",
      defaultProvider: "openai",
      rules: { "product-analysis": { provider: "anthropic", model: null } },
      modelOverrides: { "product-analysis": "gpt-4o-mini" }, // openai 전용 모델
      availableProviders: AVAILABLE,
    });
    expect(result).toMatchObject({
      provider: "anthropic",
      model: null, // Provider 기본 모델 사용
      source: "feature",
    });

    // 같은 Provider면 오버라이드가 그대로 적용된다
    expect(
      resolveRoute({
        feature: "product-analysis",
        defaultProvider: "openai",
        rules: { "product-analysis": { provider: "openai", model: null } },
        modelOverrides: { "product-analysis": "gpt-4o-mini" },
        availableProviders: AVAILABLE,
      }).model,
    ).toBe("gpt-4o-mini");
  });

  it("사용할 수 없는 Provider는 기본으로 내려간다 (source=fallback + 사유)", () => {
    const result = resolveRoute({
      feature: "content-generation",
      defaultProvider: "mock",
      rules: { "content-generation": { provider: "gemini", model: null } },
      availableProviders: AVAILABLE, // gemini 없음 (키 미설정)
    });
    expect(result.provider).toBe("mock");
    expect(result.source).toBe("fallback");
    expect(result.reason).toContain("gemini");
  });

  it("feature 미지정(dev 등)은 항상 기본 Provider", () => {
    expect(
      resolveRoute({
        defaultProvider: "openai",
        rules: { "content-generation": { provider: "anthropic", model: null } },
        availableProviders: AVAILABLE,
      }),
    ).toMatchObject({ feature: "dev", provider: "openai", source: "default" });
  });

  it("라우팅 표는 대상 feature 4종을 모두 해석한다", () => {
    const table = buildRoutingTable({
      defaultProvider: "openai",
      rules: { "vision-analysis": { provider: "anthropic", model: null } },
      availableProviders: AVAILABLE,
    });
    expect(table.map((row) => row.feature)).toEqual([...ROUTABLE_FEATURES]);
    expect(
      table.find((row) => row.feature === "vision-analysis")?.provider,
    ).toBe("anthropic");
    expect(
      table.filter((row) => row.source === "default").map((row) => row.feature),
    ).toEqual(["content-generation", "product-analysis", "design-review"]);
  });
});
