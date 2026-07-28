import {
  buildDeploymentChecklist,
  summarizeChecklist,
} from "./deployment-checklist";
import type { DeploymentState } from "./deployment-checklist";
import { validateEnvironment } from "./env-spec";

const READY: DeploymentState = {
  environment: validateEnvironment(
    {
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
    },
  ),
  database: { ok: true, detail: "연결 정상" },
  pendingMigrations: 0,
  storage: { ok: true, detail: "버킷 접근 정상" },
  availableProviders: ["mock", "openai", "anthropic"],
  defaultProvider: "openai",
  budgetConfigured: true,
  failoverConfigured: true,
  adminUserExists: true,
  production: true,
};

const item = (items: ReturnType<typeof buildDeploymentChecklist>, id: string) =>
  items.find((entry) => entry.id === id)!;

describe("Deployment Checklist (TASK-1202)", () => {
  it("준비된 상태는 배포 가능으로 판정한다", () => {
    const items = buildDeploymentChecklist(READY);
    const summary = summarizeChecklist(items);

    expect(summary.ready).toBe(true);
    expect(summary.fail).toBe(0);
    expect(summary.blockers).toEqual([]);
    // 자동 판정 불가 항목은 정직하게 manual로 남는다
    expect(summary.manual).toBeGreaterThan(0);
    expect(item(items, "smoke").status).toBe("manual");
  });

  it("환경 오류·DB·저장소·관리자 부재는 배포를 막는다", () => {
    const items = buildDeploymentChecklist({
      ...READY,
      environment: validateEnvironment({ NODE_ENV: "production" }),
      database: { ok: false, detail: "연결 실패" },
      storage: { ok: false, detail: "버킷 없음" },
      adminUserExists: false,
    });
    const summary = summarizeChecklist(items);

    expect(summary.ready).toBe(false);
    expect(summary.blockers.map((entry) => entry.id).sort()).toEqual([
      "admin-user",
      "database",
      "env",
      "storage",
    ]);
  });

  it("미적용 마이그레이션은 배포를 막고, 확인 불가면 manual", () => {
    expect(
      item(buildDeploymentChecklist({ ...READY, pendingMigrations: 2 }), "migrations"),
    ).toMatchObject({ status: "fail", blocking: true });
    expect(
      item(
        buildDeploymentChecklist({ ...READY, pendingMigrations: null }),
        "migrations",
      ).status,
    ).toBe("manual");
  });

  it("운영에서 mock만 있으면 배포를 막는다 (개발에서는 경고)", () => {
    const production = buildDeploymentChecklist({
      ...READY,
      availableProviders: ["mock"],
      defaultProvider: "mock",
    });
    expect(item(production, "provider")).toMatchObject({
      status: "fail",
      blocking: true,
    });
    expect(summarizeChecklist(production).ready).toBe(false);

    const development = buildDeploymentChecklist({
      ...READY,
      production: false,
      availableProviders: ["mock"],
      defaultProvider: "mock",
    });
    expect(item(development, "provider")).toMatchObject({
      status: "warn",
      blocking: false,
    });
    expect(summarizeChecklist(development).ready).toBe(true);
  });

  it("예산·Failover 미설정은 운영 경고이되 배포를 막지는 않는다", () => {
    const items = buildDeploymentChecklist({
      ...READY,
      budgetConfigured: false,
      failoverConfigured: false,
    });
    expect(item(items, "budget")).toMatchObject({
      status: "warn",
      blocking: false,
    });
    expect(item(items, "failover").status).toBe("warn");
    expect(summarizeChecklist(items).ready).toBe(true);
  });

  it("상태와 설명이 어긋나지 않는다 — 개발에서 통과면 경고 문구를 쓰지 않는다", () => {
    const development = buildDeploymentChecklist({
      ...READY,
      production: false,
      budgetConfigured: false,
      failoverConfigured: false,
    });
    for (const id of ["budget", "failover"]) {
      const entry = item(development, id);
      expect(entry.status).toBe("pass");
      // "통과"인데 위험을 알리는 문구가 붙으면 읽는 사람이 혼란스럽다
      expect(entry.detail).toContain("개발 환경에서는 무방");
      expect(entry.detail).not.toContain("서비스 중단");
      expect(entry.detail).not.toContain("비용 폭주");
    }
  });

  it("환경 경고만 있으면 warn으로 통과시킨다", () => {
    const items = buildDeploymentChecklist({
      ...READY,
      environment: validateEnvironment({
        NODE_ENV: "production",
        WEB_URL: "http://localhost:3000",
        DATABASE_URL: "postgresql://user:pw@db:5432/acos",
        S3_ENDPOINT: "https://s3.example.com",
        S3_BUCKET: "acos",
        S3_ACCESS_KEY: "key",
        S3_SECRET_KEY: "secret",
        AUTH_ADMIN_EMAIL: "admin@acos.example.com",
        AUTH_ADMIN_PASSWORD: "a-long-enough-password",
        LLM_PROVIDER: "openai",
        LLM_DAILY_BUDGET_USD: "50",
        LLM_FAILOVER_PRIORITY: "openai",
      }),
    });
    expect(item(items, "env").status).toBe("warn");
    expect(summarizeChecklist(items).ready).toBe(true);
  });
});
