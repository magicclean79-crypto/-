import {
  describeEnvironment,
  ENV_SPECS,
  validateEnvironment,
} from "./env-spec";

/** 운영에 필요한 최소 환경 (검증을 통과하는 기준선) */
const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: "production",
  WEB_URL: "https://acos.example.com",
  DATABASE_URL: "postgresql://user:pw@db:5432/acos",
  S3_ENDPOINT: "https://s3.example.com",
  S3_BUCKET: "acos",
  S3_ACCESS_KEY: "key",
  S3_SECRET_KEY: "secret",
  AUTH_ADMIN_EMAIL: "admin@acos.example.com",
  AUTH_ADMIN_PASSWORD: "a-long-enough-password",
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-live",
  LLM_DAILY_BUDGET_USD: "50",
  LLM_FAILOVER_PRIORITY: "openai,anthropic",
};

describe("Environment Validation (TASK-1202)", () => {
  describe("validateEnvironment", () => {
    it("운영 최소 구성은 오류·경고 없이 통과한다", () => {
      const result = validateEnvironment(PRODUCTION_ENV);
      expect(result.ok).toBe(true);
      expect(result.production).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("운영에서 필수 항목이 없으면 error", () => {
      const { DATABASE_URL, S3_BUCKET, ...rest } = PRODUCTION_ENV;
      void DATABASE_URL;
      void S3_BUCKET;
      const result = validateEnvironment(rest);
      expect(result.ok).toBe(false);
      expect(result.errors.map((issue) => issue.name).sort()).toEqual([
        "DATABASE_URL",
        "S3_BUCKET",
      ]);
    });

    it("개발 환경에서는 같은 항목이 오류가 아니다", () => {
      const result = validateEnvironment({ NODE_ENV: "development" });
      expect(result.ok).toBe(true);
      expect(result.production).toBe(false);
      expect(result.errors).toEqual([]);
    });

    it("형식 오류는 환경과 무관하게 error", () => {
      // 개발이어도 잘못된 값은 어디서도 동작하지 않는다
      const result = validateEnvironment({
        NODE_ENV: "development",
        PORT: "abc",
        DATABASE_URL: "mysql://nope",
        LLM_PROVIDER: "chatgpt",
      });
      expect(result.ok).toBe(false);
      expect(result.errors.map((issue) => issue.name).sort()).toEqual([
        "DATABASE_URL",
        "LLM_PROVIDER",
        "PORT",
      ]);
    });

    it("운영 권고 위반은 warning으로 알린다 (기동은 막지 않는다)", () => {
      const result = validateEnvironment({
        ...PRODUCTION_ENV,
        WEB_URL: "http://localhost:3000",
        AUTH_COOKIE_SECURE: "0",
        LLM_PROVIDER: "mock",
      });
      expect(result.ok).toBe(true); // 기동은 가능
      const names = result.warnings.map((issue) => issue.name);
      expect(names).toContain("WEB_URL");
      expect(names).toContain("AUTH_COOKIE_SECURE");
      expect(names).toContain("LLM_PROVIDER");
      expect(
        result.warnings.find((issue) => issue.name === "AUTH_COOKIE_SECURE")
          ?.message,
      ).toContain("평문");
    });

    it("예산·Failover 미설정은 운영에서만 경고한다", () => {
      const { LLM_DAILY_BUDGET_USD, LLM_FAILOVER_PRIORITY, ...rest } =
        PRODUCTION_ENV;
      void LLM_DAILY_BUDGET_USD;
      void LLM_FAILOVER_PRIORITY;

      const production = validateEnvironment(rest);
      expect(production.ok).toBe(true);
      expect(production.warnings.map((issue) => issue.name).sort()).toEqual([
        "LLM_DAILY_BUDGET_USD",
        "LLM_FAILOVER_PRIORITY",
      ]);

      const development = validateEnvironment({
        ...rest,
        NODE_ENV: "development",
      });
      expect(development.warnings).toEqual([]);
    });

    it("빈 문자열은 미설정으로 본다", () => {
      const result = validateEnvironment({
        ...PRODUCTION_ENV,
        DATABASE_URL: "   ",
      });
      expect(result.errors.map((issue) => issue.name)).toContain(
        "DATABASE_URL",
      );
    });

    it("production 플래그를 직접 넘길 수 있다 (NODE_ENV와 무관)", () => {
      const result = validateEnvironment(
        { NODE_ENV: "development" },
        { production: true },
      );
      expect(result.production).toBe(true);
      expect(result.ok).toBe(false);
    });
  });

  describe("describeEnvironment", () => {
    it("비밀 값은 설정 여부만 노출한다", () => {
      const views = describeEnvironment(PRODUCTION_ENV);
      const dbUrl = views.find((view) => view.name === "DATABASE_URL")!;
      expect(dbUrl).toMatchObject({ secret: true, configured: true });
      expect(dbUrl.value).toBeNull(); // 값은 절대 노출하지 않는다

      const bucket = views.find((view) => view.name === "S3_BUCKET")!;
      expect(bucket).toMatchObject({ secret: false, value: "acos" });
    });

    it("미설정 항목은 configured=false와 대체 동작을 알린다", () => {
      const views = describeEnvironment({});
      const provider = views.find((view) => view.name === "LLM_PROVIDER")!;
      expect(provider.configured).toBe(false);
      expect(provider.fallback).toContain("mock");
    });

    it("선언된 모든 항목을 빠짐없이 돌려준다", () => {
      expect(describeEnvironment({})).toHaveLength(ENV_SPECS.length);
    });
  });

  it("선언 목록에 중복 이름이 없다", () => {
    const names = ENV_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
