import {
  enabledProviders,
  experimentKey,
  modelEnvName,
  modelKey,
  providerEnabledKey,
  resolveSetting,
  SettingValidationError,
  validateSetting,
} from "./settings";

describe("Provider Administration 설정 (TASK-1201)", () => {
  describe("validateSetting", () => {
    it("Provider Enable/Disable — 등록된 Provider와 true/false만 허용", () => {
      expect(() =>
        validateSetting(providerEnabledKey("openai"), "false"),
      ).not.toThrow();
      expect(() =>
        validateSetting(providerEnabledKey("openai"), null),
      ).not.toThrow();
      expect(() => validateSetting(providerEnabledKey("cohere"), "true")).toThrow(
        /알 수 없는 Provider/,
      );
      expect(() => validateSetting(providerEnabledKey("openai"), "yes")).toThrow(
        /"true" 또는 "false"/,
      );
    });

    it("Model Management — 라우팅 대상 feature만 허용", () => {
      expect(() =>
        validateSetting(modelKey("product-analysis"), "gpt-4o-mini"),
      ).not.toThrow();
      expect(() => validateSetting(modelKey("unknown"), "gpt-4o")).toThrow(
        /대상 feature가 아닙니다/,
      );
      expect(() => validateSetting(modelKey("product-analysis"), "  ")).toThrow(
        /비어 있습니다/,
      );
    });

    it("Budget Management — 양수만, 경고 임계는 0~1", () => {
      expect(() => validateSetting("budget.daily", "10")).not.toThrow();
      expect(() => validateSetting("budget.monthly", null)).not.toThrow();
      expect(() => validateSetting("budget.daily", "0")).toThrow(/0보다 큰/);
      expect(() => validateSetting("budget.daily", "abc")).toThrow(/0보다 큰/);
      expect(() => validateSetting("budget.alertRatio", "0.8")).not.toThrow();
      expect(() => validateSetting("budget.alertRatio", "1.5")).toThrow(
        /0과 1 사이/,
      );
    });

    it("Experiment Management — 해석 가능한 정의만 허용", () => {
      expect(() =>
        validateSetting(
          experimentKey("product-analysis"),
          "canary|openai=90,anthropic=10",
        ),
      ).not.toThrow();
      expect(() =>
        validateSetting(experimentKey("product-analysis"), "=,="),
      ).toThrow(/해석할 수 없습니다/);
      expect(() => validateSetting(experimentKey("nope"), "openai=1")).toThrow(
        /실험 대상 feature가 아닙니다/,
      );
    });

    it("지원하지 않는 키는 거부한다", () => {
      expect(() => validateSetting("random.key", "1")).toThrow(
        SettingValidationError,
      );
    });
  });

  describe("resolveSetting", () => {
    it("오버라이드 > 환경변수 > 기본값 순으로 유효값을 정한다", () => {
      expect(
        resolveSetting({
          key: "budget.daily",
          override: "20",
          envValue: "10",
          defaultValue: null,
        }),
      ).toMatchObject({ value: "20", source: "override", fallback: "10" });

      expect(
        resolveSetting({
          key: "budget.daily",
          override: null,
          envValue: "10",
        }),
      ).toMatchObject({ value: "10", source: "env" });

      expect(
        resolveSetting({
          key: "budget.alertRatio",
          override: null,
          envValue: null,
          defaultValue: "0.8",
        }),
      ).toMatchObject({ value: "0.8", source: "default", fallback: null });
    });

    it("오버라이드가 빈 문자열이어도 오버라이드로 본다 (null만 해제)", () => {
      expect(
        resolveSetting({ key: "model.x", override: "", envValue: "gpt-4o" }),
      ).toMatchObject({ value: "", source: "override" });
    });
  });

  describe("enabledProviders", () => {
    it("비활성 Provider를 후보에서 제외한다", () => {
      expect(
        enabledProviders({
          available: ["mock", "openai", "anthropic"],
          isDisabled: (provider) => provider === "openai",
        }),
      ).toEqual(["mock", "anthropic"]);
    });

    it("전부 비활성이면 무시한다 — 호출이 전멸하지 않게", () => {
      expect(
        enabledProviders({
          available: ["mock", "openai"],
          isDisabled: () => true,
        }),
      ).toEqual(["mock", "openai"]);
    });
  });

  it("modelEnvName — 표시용 환경변수명", () => {
    expect(modelEnvName("product-analysis")).toBe("LLM_MODEL_ANALYSIS");
    expect(modelEnvName("unknown")).toBeNull();
  });
});
