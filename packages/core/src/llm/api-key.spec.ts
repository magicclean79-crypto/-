import {
  keyHint,
  providerKeyRequired,
  validateAllApiKeyFormats,
  validateApiKeyFormat,
} from "./api-key";

describe("API Key Validation (TASK-1301)", () => {
  describe("validateApiKeyFormat", () => {
    it("형식이 맞으면 ok — 다만 유효성 보장이 아님을 명시한다", () => {
      const result = validateApiKeyFormat("openai", "sk-proj-abcdefghijklmnop1234");
      expect(result.status).toBe("ok");
      expect(result.message).toContain("Live Check");
    });

    it("Provider별 접두사를 확인한다", () => {
      expect(
        validateApiKeyFormat("anthropic", "sk-ant-api03-abcdefghijklmnop").status,
      ).toBe("ok");
      // openai 키를 anthropic에 넣은 전형적인 실수
      expect(
        validateApiKeyFormat("anthropic", "sk-proj-abcdefghijklmnop1234"),
      ).toMatchObject({ status: "invalid" });
      // gemini는 고정 접두사가 없어 길이만 본다
      expect(
        validateApiKeyFormat("gemini", "AIzaSyA-abcdefghijklmnopqrstu").status,
      ).toBe("ok");
    });

    it("미설정은 missing", () => {
      expect(validateApiKeyFormat("openai", undefined)).toMatchObject({
        status: "missing",
        hint: null,
        length: null,
      });
      expect(validateApiKeyFormat("openai", "   ").status).toBe("missing");
    });

    it("플레이스홀더를 잡아낸다 (배포 사고의 단골)", () => {
      for (const value of [
        "sk-xxxxxxxxxxxxxxxxxxxx",
        "sk-your-api-key-here",
        "your-api-key",
        "changeme",
        "sk-test-key-placeholder",
      ]) {
        expect([value, validateApiKeyFormat("openai", value).status]).toEqual([
          value,
          "placeholder",
        ]);
      }
    });

    it("너무 짧거나 공백이 섞이면 invalid", () => {
      expect(validateApiKeyFormat("openai", "sk-short").status).toBe("invalid");
      expect(
        validateApiKeyFormat("openai", "sk-abcdefghij klmnopqrstuv"),
      ).toMatchObject({ status: "invalid" });
      expect(
        validateApiKeyFormat("openai", "sk-abcdefghij klmnopqrstuv").message,
      ).toContain("공백");
    });

    it("키 값을 노출하지 않는다 — 앞부분과 길이만", () => {
      const key = "sk-proj-super-secret-value-1234567890";
      const result = validateApiKeyFormat("openai", key);
      expect(result.hint).toBe("sk-pro…");
      expect(result.length).toBe(key.length);
      expect(JSON.stringify(result)).not.toContain("super-secret");
      expect(keyHint("abc")).toBe("…");
    });

    it("알 수 없는 Provider는 길이만 확인한다", () => {
      expect(
        validateApiKeyFormat("cohere", "some-reasonably-long-key-value").status,
      ).toBe("ok");
    });
  });

  describe("validateAllApiKeyFormats", () => {
    it("키가 필요한 Provider 전부를 검사한다 (mock 제외)", () => {
      const results = validateAllApiKeyFormats({
        OPENAI_API_KEY: "sk-proj-abcdefghijklmnop1234",
        ANTHROPIC_API_KEY: "sk-ant-api03-abcdefghijklmnop",
      });
      const byProvider = Object.fromEntries(
        results.map((result) => [result.provider, result.status]),
      );
      expect(byProvider).toEqual({
        openai: "ok",
        anthropic: "ok",
        gemini: "missing",
      });
      expect(results.some((result) => result.provider === "mock")).toBe(false);
    });
  });

  describe("providerKeyRequired (CTO 결정 1202-②)", () => {
    it("기본 Provider로 지정되면 필요하다", () => {
      expect(providerKeyRequired("openai", { LLM_PROVIDER: "openai" })).toBe(
        true,
      );
      expect(providerKeyRequired("anthropic", { LLM_PROVIDER: "openai" })).toBe(
        false,
      );
    });

    it("라우팅·Failover·실험 어디서든 참조하면 필요하다", () => {
      expect(
        providerKeyRequired("anthropic", {
          LLM_ROUTE_ANALYSIS: "anthropic:claude-sonnet-5",
        }),
      ).toBe(true);
      expect(
        providerKeyRequired("gemini", { LLM_FAILOVER_PRIORITY: "openai,gemini" }),
      ).toBe(true);
      expect(
        providerKeyRequired("anthropic", {
          LLM_EXPERIMENT_ANALYSIS: "canary|openai=90,anthropic=10",
        }),
      ).toBe(true);
    });

    it("이름이 부분 문자열로만 겹치면 참조로 보지 않는다", () => {
      // "openai-legacy"가 있다고 "openai"가 참조된 것은 아니다
      expect(
        providerKeyRequired("openai", { LLM_FAILOVER_PRIORITY: "openai-legacy" }),
      ).toBe(false);
    });

    it("mock은 키가 필요 없다", () => {
      expect(providerKeyRequired("mock", { LLM_PROVIDER: "mock" })).toBe(false);
    });

    it("아무 데서도 참조하지 않으면 필요 없다", () => {
      expect(providerKeyRequired("gemini", { LLM_PROVIDER: "mock" })).toBe(false);
      expect(providerKeyRequired("gemini", {})).toBe(false);
    });
  });
});
