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
      LLM_FAILOVER_PRIORITY: "openai",
      ALERT_WEBHOOK_URL: "https://hooks.example.com/acos",
      REDIS_URL: "redis://cache:6379",
      // 재해 복구 (TASK-1601·1701) — BACKUP_DIR은 운영 필수(결정 1601-①)
      TZ: "Asia/Seoul",
      BACKUP_DIR: "/var/backups/acos",
      BACKUP_RESTORE_DB_URL: "postgresql://user:pw@db:5432/acos_restore_check",
      BACKUP_OFFSITE: "on",
    },
  ),
  database: { ok: true, detail: "연결 정상" },
  migrations: {
    status: "pass",
    detail: "마이그레이션 2건 모두 적용됨.",
    pending: [],
    unknown: [],
    appliedBy: "operator",
  },
  // 운영 표준 배포 체크리스트 (TASK-2301, CTO 결정 2201-④)
  operations: {
    provisioningMode: "external",
    bucket: { name: "acos", exists: true },
    backupBucket: { name: "acos-backups", exists: true, separated: true },
    versioning: "enabled",
    backupVersioning: "enabled",
    recoverable: true,
  },
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
      item(
        buildDeploymentChecklist({
          ...READY,
          migrations: {
            status: "fail",
            detail: "미적용 마이그레이션 2건: a, b — 운영 담당자가 적용해야 합니다.",
            pending: ["a", "b"],
            unknown: [],
            appliedBy: "operator",
          },
        }),
        "migrations",
      ),
    ).toMatchObject({ status: "fail", blocking: true });
    expect(
      item(
        buildDeploymentChecklist({
          ...READY,
          migrations: {
            status: "manual",
            detail: "스키마 적용 상태를 확인하지 못했습니다.",
            pending: [],
            unknown: [],
            appliedBy: "operator",
          },
        }),
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

  it("복구 리허설은 배포 체크리스트에 들어가지 않는다 (CTO 결정 1801-②)", () => {
    // 운영 표준이지만 배포를 막지는 않는다 — 경보로만 다룬다.
    // 배포 게이트에 넣으면 리허설이 밀렸다는 이유로 긴급 배포가 막힌다.
    const ids = buildDeploymentChecklist(READY).map((entry) => entry.id);
    expect(ids).not.toContain("drill");
    expect(ids).not.toContain("recovery-drill");
    expect(ids).not.toContain("backup-performance");
  });

  it("환경 경고만 있으면 warn으로 통과시킨다", () => {
    const items = buildDeploymentChecklist({
      ...READY,
      environment: validateEnvironment({
        NODE_ENV: "production",
        WEB_URL: "http://localhost:3000",
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
        LLM_FAILOVER_PRIORITY: "openai",
        // 운영 필수 항목은 갖춘 상태여야 "경고만"이 된다 (결정 1601-①)
        BACKUP_DIR: "/var/backups/acos",
      }),
    });
    expect(item(items, "env").status).toBe("warn");
    expect(summarizeChecklist(items).ready).toBe(true);
  });
});

describe("운영 표준 배포 체크리스트 (TASK-2301, CTO 결정 2201-④)", () => {
  const ops = (overrides: Partial<DeploymentState["operations"]>) =>
    buildDeploymentChecklist({
      ...READY,
      operations: { ...READY.operations, ...overrides },
    });

  it("승격된 다섯 항목이 모두 있다", () => {
    const ids = buildDeploymentChecklist(READY).map((entry) => entry.id);
    for (const id of [
      "bucket",
      "iam",
      "versioning",
      "backup-bucket",
      "readiness",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("준비가 끝나 있으면 다섯 항목 모두 통과", () => {
    const items = buildDeploymentChecklist(READY).filter((entry) =>
      ["bucket", "iam", "versioning", "backup-bucket", "readiness"].includes(
        entry.id,
      ),
    );
    expect(items.every((entry) => entry.status === "pass")).toBe(true);
  });

  it("운영에서 버킷이 없으면 배포를 막고, 만들지 않는다고 말한다", () => {
    const item = ops({ bucket: { name: "acos", exists: false } }).find(
      (entry) => entry.id === "bucket",
    )!;
    expect(item).toMatchObject({ status: "fail", blocking: true });
    expect(item.detail).toContain("운영 담당자가 버킷을 만들어야 합니다");
    expect(item.detail).toContain("애플리케이션은 만들지 않습니다");
  });

  it("보호 상태를 읽지 못하면 IAM 권한을 의심하라고 말한다", () => {
    const item = ops({ versioning: "unknown" }).find(
      (entry) => entry.id === "iam",
    )!;
    expect(item.status).toBe("warn");
    expect(item.detail).toContain("s3:GetBucketVersioning");
    // 저장소가 S3인 것과 상태를 읽을 수 있는 것은 다르다
    expect(item.detail).toContain("상태를 읽을 수 있는 것은 다릅니다");
  });

  it("IAM 항목은 배포를 막지 않는다 — 읽지 못해도 지금 서비스는 돈다", () => {
    expect(
      ops({ versioning: "unknown" }).find((entry) => entry.id === "iam")!
        .blocking,
    ).toBe(false);
  });

  it("운영에서 버전 관리가 꺼져 있으면 배포를 막는다 (CTO 결정 1701-③)", () => {
    const item = ops({ versioning: "disabled" }).find(
      (entry) => entry.id === "versioning",
    )!;
    expect(item).toMatchObject({ status: "fail", blocking: true });
    expect(item.detail).toContain("되돌릴 수 없습니다");
  });

  it("버전 관리를 확인할 수 없으면 직접 확인으로 남기고 막지 않는다", () => {
    const item = ops({ versioning: "unknown" }).find(
      (entry) => entry.id === "versioning",
    )!;
    expect(item.status).toBe("manual");
    expect(item.blocking).toBe(false);
  });

  it("백업 버킷이 이미지 버킷과 같으면 함께 사라진다고 말한다", () => {
    const item = ops({
      backupBucket: { name: "acos", exists: true, separated: false },
    }).find((entry) => entry.id === "backup-bucket")!;
    expect(item.status).toBe("fail");
    expect(item.detail).toContain("함께 사라집니다");
  });

  it("백업 버킷이 없으면 운영에서 배포를 막는다", () => {
    const item = ops({
      backupBucket: { name: "acos-backups", exists: false, separated: true },
    }).find((entry) => entry.id === "backup-bucket")!;
    expect(item).toMatchObject({ status: "fail", blocking: true });
  });

  it("복구 불가 상태로는 배포하지 않는다", () => {
    const item = ops({ recoverable: false }).find(
      (entry) => entry.id === "readiness",
    )!;
    expect(item).toMatchObject({ status: "fail", blocking: true });
    expect(item.detail).toContain("지금 무너지면 되살릴 수 없습니다");
  });

  it("복구 판정을 확인하지 못하면 직접 확인이다", () => {
    expect(
      ops({ recoverable: null }).find((entry) => entry.id === "readiness")!
        .status,
    ).toBe("manual");
  });

  it("복구 리허설은 배포 게이트에 들어오지 않는다 (CTO 결정 1801-②)", () => {
    const ids = buildDeploymentChecklist(READY).map((entry) => entry.id);
    expect(ids).not.toContain("drill");
    expect(ids).not.toContain("backup-performance");
  });

  it("개발에서는 준비가 안 돼 있어도 배포를 막지 않는다", () => {
    const items = buildDeploymentChecklist({
      ...READY,
      production: false,
      operations: {
        ...READY.operations,
        provisioningMode: "managed",
        bucket: { name: "acos", exists: false },
        versioning: "disabled",
        backupBucket: { name: "acos", exists: false, separated: false },
        backupVersioning: "disabled",
        recoverable: false,
      },
    });
    expect(summarizeChecklist(items).blockers).toEqual([]);
  });

  it("운영 담당자가 적용한다는 사실이 마이그레이션 제목에 드러난다", () => {
    const item = buildDeploymentChecklist(READY).find(
      (entry) => entry.id === "migrations",
    )!;
    expect(item.title).toContain("운영 담당자 수행");
  });

  it("개발에서는 제목에 주체를 붙이지 않는다", () => {
    const item = buildDeploymentChecklist({
      ...READY,
      migrations: { ...READY.migrations, appliedBy: "developer" },
    }).find((entry) => entry.id === "migrations")!;
    expect(item.title).toBe("마이그레이션 적용");
  });
});
