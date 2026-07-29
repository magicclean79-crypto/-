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
  // 운영 저장소 표준은 Amazon S3다 (CTO 결정 1801-④)
  S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
  S3_BUCKET: "acos",
  S3_ACCESS_KEY: "key",
  S3_SECRET_KEY: "secret",
  AUTH_ADMIN_EMAIL: "admin@acos.example.com",
  AUTH_ADMIN_PASSWORD: "a-long-enough-password",
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-proj-abcdefghijklmnop1234",
  LLM_DAILY_BUDGET_USD: "50",
  // 참조하는 Provider의 키는 운영 필수(CTO 결정 1202-②) — openai만 참조한다
  LLM_FAILOVER_PRIORITY: "openai",
  // 경보 전달 채널 (TASK-1302) — 없으면 경보가 로그에만 남는다
  ALERT_WEBHOOK_URL: "https://hooks.example.com/acos",
  // 분산 잠금 (TASK-1401) — 없으면 다중 인스턴스에서 점검이 중복 실행된다
  REDIS_URL: "redis://cache:6379",
  // 재해 복구 (TASK-1601) — 백업 위치와 복원 검증 대상이 운영 기준선에 들어왔다
  TZ: "Asia/Seoul",
  BACKUP_DIR: "/var/backups/acos",
  BACKUP_RESTORE_DB_URL: "postgresql://user:pw@db:5432/acos_restore_check",
  // 백업 원격 복제 (TASK-1701) — 없으면 호스트와 함께 백업도 사라진다
  BACKUP_OFFSITE: "on",
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

  describe("Provider 키 조건부 필수 (CTO 결정 1202-②)", () => {
    it("쓰지 않는 Provider의 키는 운영에서도 필수가 아니다", () => {
      const result = validateEnvironment(PRODUCTION_ENV);
      expect(result.ok).toBe(true);
      // anthropic·gemini는 어디서도 참조하지 않으므로 키가 없어도 된다
      expect(result.errors.map((issue) => issue.name)).not.toContain(
        "ANTHROPIC_API_KEY",
      );
    });

    it("참조하는 Provider의 키가 없으면 운영에서 error", () => {
      const result = validateEnvironment({
        ...PRODUCTION_ENV,
        LLM_ROUTE_ANALYSIS: "anthropic:claude-sonnet-5",
        LLM_FAILOVER_PRIORITY: "openai,gemini",
      });
      expect(result.ok).toBe(false);
      expect(result.errors.map((issue) => issue.name).sort()).toEqual([
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
      ]);
    });

    it("키 형식이 틀리면 환경과 무관하게 error", () => {
      const result = validateEnvironment({
        NODE_ENV: "development",
        OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxx", // 플레이스홀더
        ANTHROPIC_API_KEY: "sk-proj-wrong-prefix-1234", // 접두사 불일치
      });
      expect(result.errors.map((issue) => issue.name).sort()).toEqual([
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
      ]);
      expect(
        result.errors.find((issue) => issue.name === "OPENAI_API_KEY")?.message,
      ).toContain("플레이스홀더");
    });

    it("설정 현황에도 조건부 필수가 반영된다", () => {
      const views = describeEnvironment({
        ...PRODUCTION_ENV,
        LLM_ROUTE_VISION: "gemini",
      });
      expect(
        views.find((view) => view.name === "GEMINI_API_KEY")
          ?.requiredInProduction,
      ).toBe(true);
      expect(
        views.find((view) => view.name === "ANTHROPIC_API_KEY")
          ?.requiredInProduction,
      ).toBe(false);
    });
  });

  describe("재해 복구 설정 (TASK-1601)", () => {
    it("복원 검증 대상이 없으면 운영에서 경고한다", () => {
      const { BACKUP_RESTORE_DB_URL, ...rest } = PRODUCTION_ENV;
      void BACKUP_RESTORE_DB_URL;
      const result = validateEnvironment(rest);
      // 기동은 막지 않는다 — 다만 "복원해 본 적 없는 백업"임을 알린다
      expect(result.ok).toBe(true);
      expect(
        result.warnings.find((issue) => issue.name === "BACKUP_RESTORE_DB_URL")
          ?.message,
      ).toContain("복원해 보지 않은 백업은 백업이 아닙니다");
    });

    it("백업 위치가 없으면 운영에서 기동을 막는다 (CTO 결정 1601-①)", () => {
      // 백업이 컨테이너와 함께 사라지는 구성으로 운영을 시작할 수는 없다
      const { BACKUP_DIR, ...rest } = PRODUCTION_ENV;
      void BACKUP_DIR;
      const result = validateEnvironment(rest);
      expect(result.ok).toBe(false);
      expect(result.errors.map((issue) => issue.name)).toContain("BACKUP_DIR");

      // 개발에서는 여전히 오류가 아니다
      expect(
        validateEnvironment({ ...rest, NODE_ENV: "development" }).ok,
      ).toBe(true);
    });

    it("원격 복제가 꺼져 있으면 경고하되 기동은 막지 않는다", () => {
      const { BACKUP_OFFSITE, ...rest } = PRODUCTION_ENV;
      void BACKUP_OFFSITE;
      const result = validateEnvironment(rest);
      expect(result.ok).toBe(true);
      expect(
        result.warnings.find((issue) => issue.name === "BACKUP_OFFSITE")
          ?.message,
      ).toContain("백업도 함께 사라집니다");
    });

    it("복원 대상이 운영 DB면 환경과 무관하게 기동을 막는다 (CTO 결정 1601-②)", () => {
      // 복원은 대상을 지우고 쓴다 — 개발에서도 허용할 수 없다
      const result = validateEnvironment({
        ...PRODUCTION_ENV,
        BACKUP_RESTORE_DB_URL: "postgresql://other:pw@db:5432/acos",
      });
      expect(result.ok).toBe(false);
      expect(
        result.errors.find((issue) => issue.name === "BACKUP_RESTORE_DB_URL")
          ?.message,
      ).toContain("검증이 곧 사고가 됩니다");

      expect(
        validateEnvironment({
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://user:pw@db:5432/acos",
          BACKUP_RESTORE_DB_URL: "postgresql://user:pw@db:5432/acos",
        }).ok,
      ).toBe(false);
    });

    it("복원 검증 DB 주소는 비밀로 다룬다 — 화면에 노출하지 않는다", () => {
      const view = describeEnvironment(PRODUCTION_ENV).find(
        (item) => item.name === "BACKUP_RESTORE_DB_URL",
      )!;
      expect(view).toMatchObject({ secret: true, configured: true });
      expect(view.value).toBeNull();
    });
  });

  it("설명·대체 동작에 마크다운 강조를 쓰지 않는다", () => {
    // 설명은 기동 실패 로그와 화면에 그대로 실린다 — 별표가 보이면 안 된다
    for (const spec of ENV_SPECS) {
      expect(spec.description).not.toContain("**");
      expect(spec.fallback ?? "").not.toContain("**");
    }
  });

  it("선언 목록에 중복 이름이 없다", () => {
    const names = ENV_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("관측 창 설정은 기동을 막지 않는다 (TASK-2201, CTO 결정 2101-②)", () => {
  it("해석할 수 없는 값이어도 환경 오류가 아니다", () => {
    const result = validateEnvironment({
      NODE_ENV: "production",
      BACKUP_CHAIN_WINDOW_HOURS: "이십사",
    });
    expect(
      result.errors.some((issue) => issue.name === "BACKUP_CHAIN_WINDOW_HOURS"),
    ).toBe(false);
  });

  it("대신 운영에서 권고로 알린다", () => {
    const result = validateEnvironment({
      NODE_ENV: "production",
      BACKUP_CHAIN_WINDOW_HOURS: "이십사",
    });
    const advice = result.warnings.find(
      (issue) => issue.name === "BACKUP_CHAIN_WINDOW_HOURS",
    );
    expect(advice?.message).toContain("기동은 막지 않습니다");
  });

  it("정상 값에는 아무 말도 하지 않는다", () => {
    const result = validateEnvironment({
      NODE_ENV: "production",
      BACKUP_CHAIN_WINDOW_HOURS: "48",
    });
    expect(
      [...result.errors, ...result.warnings].some(
        (issue) => issue.name === "BACKUP_CHAIN_WINDOW_HOURS",
      ),
    ).toBe(false);
  });
});
