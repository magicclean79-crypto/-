import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveProvisioningPolicy } from "@acos/core";
import { StorageService } from "../storage/storage.service";
import { HealthController } from "./health.controller";
import { ReadinessService } from "./readiness.service";

/**
 * Production Readiness 검증. (TASK-1202, Sprint 12)
 *
 * ① 실제 상태(DB·저장소·마이그레이션·Provider·관리자)로 체크리스트를 채우는지
 * ② 한 구성 요소가 죽어도 나머지 보고가 유지되는지
 * ③ 비밀 값이 노출되지 않는지 ④ 기동 검증이 운영에서만 치명적인지
 * ⑤ 보고가 ADMIN 전용인지 (CTO 결정 1201-⑤)
 */
describe("Production Readiness (TASK-1202)", () => {
  let app: INestApplication;
  let readiness: ReadinessService;

  /** 실제 서비스가 읽는 것과 같은 목록 — 대조가 실제로 이뤄지는지 보려면 필요하다 */
  const migrationDirs = readdirSync(
    join(process.cwd(), "prisma", "migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const state = {
    dbOk: true,
    storageOk: true,
    /** 미적용 마이그레이션 (TASK-2301) — 디렉터리에는 있고 적용 기록에는 없는 것 */
    pending: 0,
    /** 적용 중 실패·롤백 건수 */
    failed: 0,
    admins: 1,
    providers: ["mock", "openai"],
    /** 운영 표준 배포 체크리스트 입력 (TASK-2301, CTO 결정 2201-④) */
    bucketExists: true,
    backupBucketExists: true,
    versioning: "enabled" as "enabled" | "disabled" | "unknown",
    backups: 1,
    restores: 1,
  };

  beforeAll(async () => {
    const prisma = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join(" ");
        // 적용 기록 조회 — 실제 서비스와 같이 **목록**을 돌려준다.
        // 실패 행 수만 세면 미적용을 알 수 없다는 것이 이번 TASK의 요지다.
        if (sql.includes("migration_name")) {
          // readiness.service가 읽는 디렉터리 수만큼 적용됐다고 보고,
          // state.pending개는 빼서 미적용 상황을 만든다
          return migrationDirs
            .slice(0, Math.max(0, migrationDirs.length - state.pending))
            .map((name) => ({ migration_name: name }));
        }
        if (sql.includes("_prisma_migrations")) {
          return [{ count: BigInt(state.failed) }];
        }
        if (sql.includes("backup_runs")) {
          return [
            { backups: BigInt(state.backups), restores: BigInt(state.restores) },
          ];
        }
        if (!state.dbOk) {
          throw new Error("connection refused");
        }
        return [{ "?column?": 1 }];
      },
      user: { count: async () => state.admins },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        ReadinessService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: {
            check: async () => {
              if (!state.storageOk) throw new Error("버킷을 찾을 수 없습니다");
              return "버킷 접근 정상 (acos)";
            },
            bucket: "acos",
            backupBucket: "acos-backups",
            get provisioning() {
              return resolveProvisioningPolicy(
                process.env as Record<string, string | undefined>,
              );
            },
            bucketExists: async (bucket = "acos") => {
              const exists =
                bucket === "acos-backups"
                  ? state.backupBucketExists
                  : state.bucketExists;
              if (exists === null) {
                throw new Error("조회 실패");
              }
              return exists;
            },
            describeProtection: async () => ({
              versioning: state.versioning,
              replication: state.versioning,
            }),
            describeBackupProtection: async () => ({
              versioning: state.versioning,
              replication: state.versioning,
            }),
          },
        },
        {
          provide: LlmService,
          useValue: {
            routing: () => ({
              availableProviders: state.providers,
              defaultProvider: state.providers[0],
              routes: [],
            }),
          },
        },
        {
          provide: LlmBudgetService,
          useValue: {
            status: async () => ({
              daily: { budget: 10, spend: 0, ratio: 0, status: "ok" },
              monthly: { budget: null, spend: 0, ratio: null, status: "off" },
              alertRatio: 0.8,
              checkedAt: new Date().toISOString(),
            }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateToken: async (token: string) =>
              token === "tok-admin"
                ? { id: "u-a", email: "admin@acos.local", role: "ADMIN" }
                : token === "tok-editor"
                  ? { id: "u-e", email: "e@acos.local", role: "EDITOR" }
                  : null,
          },
        },
        { provide: APP_GUARD, useClass: WriteProtectionGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    readiness = moduleRef.get(ReadinessService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    state.dbOk = true;
    state.storageOk = true;
    state.pending = 0;
    state.admins = 1;
    state.providers = ["mock", "openai"];
    delete process.env.NODE_ENV_OVERRIDE;
  });

  const asAdmin = (url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", "Bearer tok-admin");

  it("생존 확인은 무인증이고 내부 구성을 담지 않는다", async () => {
    const response = await request(app.getHttpServer())
      .get("/health/live")
      .expect(200);
    expect(response.body).toMatchObject({ status: "ok" });
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // 설정·구성 요소 정보는 절대 담기지 않는다
    expect(response.body.checklist).toBeUndefined();
    expect(response.body.configuration).toBeUndefined();
  });

  it("배포 준비 보고 — 구성 요소·체크리스트·설정 현황을 담는다", async () => {
    const response = await asAdmin("/health/ready").expect(200);

    expect(response.body.components.map((c: { name: string }) => c.name)).toEqual(
      ["database", "storage"],
    );
    expect(
      response.body.components.every((c: { ok: boolean }) => c.ok),
    ).toBe(true);
    expect(response.body.pendingMigrations).toBe(0);
    expect(response.body.providers.available).toEqual(["mock", "openai"]);

    const ids = response.body.checklist.map((item: { id: string }) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "env",
        "database",
        "migrations",
        "storage",
        "admin-user",
        "provider",
        "budget",
        "failover",
      ]),
    );
    expect(response.body.summary.ready).toBe(true);
  });

  it("DB가 죽어도 나머지 점검 결과는 유지된다 (독립 실패)", async () => {
    state.dbOk = false;
    const response = await asAdmin("/health/ready").expect(200);

    const db = response.body.components.find(
      (c: { name: string }) => c.name === "database",
    );
    const storage = response.body.components.find(
      (c: { name: string }) => c.name === "storage",
    );
    expect(db.ok).toBe(false);
    expect(db.detail).toContain("connection refused");
    // 저장소 점검은 그대로 살아 있다 — 장애 대응에 필요한 정보
    expect(storage.ok).toBe(true);
    expect(response.body.summary.ready).toBe(false);
    expect(
      response.body.summary.blockers.map((item: { id: string }) => item.id),
    ).toContain("database");
  });

  it("저장소 실패·미적용 마이그레이션·관리자 부재가 배포를 막는다", async () => {
    state.storageOk = false;
    state.pending = 3;
    state.admins = 0;

    const response = await asAdmin("/health/ready").expect(200);
    const blockers = response.body.summary.blockers.map(
      (item: { id: string }) => item.id,
    );
    expect(blockers).toEqual(
      expect.arrayContaining(["storage", "migrations", "admin-user"]),
    );
    expect(response.body.ready).toBe(false);
  });

  it("설정 현황에 비밀 값이 노출되지 않는다", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db:5432/acos";
    const response = await asAdmin("/health/ready").expect(200);

    const dbUrl = response.body.configuration.find(
      (item: { name: string }) => item.name === "DATABASE_URL",
    );
    expect(dbUrl).toMatchObject({ secret: true, configured: true });
    expect(dbUrl.value).toBeNull();
    // 응답 어디에도 실제 비밀 값이 없다
    expect(JSON.stringify(response.body)).not.toContain("secret@db");
  });

  it("기동 검증 — 개발에서는 오류가 있어도 치명적이지 않다", () => {
    const original = process.env.NODE_ENV;
    const originalDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "mysql://wrong";

    const result = readiness.validateOnStartup();
    expect(result.ok).toBe(false); // 형식 오류는 잡는다
    expect(result.fatal).toBe(false); // 개발 기동은 막지 않는다

    process.env.NODE_ENV = original;
    if (originalDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDb;
  });

  it("기동 검증 — 운영에서 필수 항목이 없으면 치명적", () => {
    const original = { ...process.env };
    process.env.NODE_ENV = "production";
    delete process.env.S3_BUCKET;
    delete process.env.AUTH_ADMIN_EMAIL;

    const result = readiness.validateOnStartup();
    expect(result).toEqual({ ok: false, fatal: true });

    process.env.NODE_ENV = original.NODE_ENV;
    if (original.S3_BUCKET) process.env.S3_BUCKET = original.S3_BUCKET;
    if (original.AUTH_ADMIN_EMAIL)
      process.env.AUTH_ADMIN_EMAIL = original.AUTH_ADMIN_EMAIL;
  });

  it("보고는 ADMIN 전용 — EDITOR 403, 미인증 401 (CTO 결정 1201-⑤)", async () => {
    await request(app.getHttpServer()).get("/health/ready").expect(401);
    await request(app.getHttpServer())
      .get("/health/ready")
      .set("Authorization", "Bearer tok-editor")
      .expect(403);
  });

  describe("Enterprise Deployment Governance (TASK-2301)", () => {
    beforeEach(() => {
      state.dbOk = true;
      state.storageOk = true;
      state.pending = 0;
      state.failed = 0;
      state.admins = 1;
      state.bucketExists = true;
      state.backupBucketExists = true;
      state.versioning = "enabled";
      state.backups = 1;
      state.restores = 1;
    });

    const report = async () => (await asAdmin("/health/ready").expect(200)).body;

    it("적용하지 않은 마이그레이션을 목록 대조로 잡아낸다 (CTO 결정 2201-①)", async () => {
      // 적용하지 않은 마이그레이션은 실패 행조차 남기지 않는다 —
      // failed=0인데도 미적용이 있는 상황이 거짓 통과의 원인이었다
      state.pending = 2;
      state.failed = 0;

      const body = await report();
      expect(body.pendingMigrations).toBe(2);
      expect(body.migrations.status).toBe("fail");
      expect(body.migrations.pending).toHaveLength(2);
      expect(
        body.summary.blockers.map((item: { id: string }) => item.id),
      ).toContain("migrations");
    });

    it("운영에서는 적용 주체가 운영 담당자다", async () => {
      process.env.NODE_ENV = "production";
      const body = await report();
      expect(body.migrations.appliedBy).toBe("operator");
      expect(
        body.checklist.find((item: { id: string }) => item.id === "migrations")
          .title,
      ).toContain("운영 담당자 수행");
    });

    it("전부 적용됐으면 통과하고 미적용 0으로 보고한다", async () => {
      const body = await report();
      expect(body.migrations.status).toBe("pass");
      expect(body.pendingMigrations).toBe(0);
    });

    it("운영 표준 다섯 항목이 배포 체크리스트에 있다 (CTO 결정 2201-④)", async () => {
      const ids = (await report()).checklist.map(
        (item: { id: string }) => item.id,
      );
      for (const id of ["bucket", "iam", "versioning", "backup-bucket", "readiness"]) {
        expect(ids).toContain(id);
      }
    });

    it("운영에서 버킷이 없으면 배포를 막는다", async () => {
      process.env.NODE_ENV = "production";
      state.bucketExists = false;

      const body = await report();
      expect(
        body.summary.blockers.map((item: { id: string }) => item.id),
      ).toContain("bucket");
      expect(
        body.checklist.find((item: { id: string }) => item.id === "bucket")
          .detail,
      ).toContain("운영 담당자가 버킷을 만들어야 합니다");
    });

    it("운영에서 백업 버킷이 없으면 배포를 막는다", async () => {
      process.env.NODE_ENV = "production";
      state.backupBucketExists = false;

      expect(
        (await report()).summary.blockers.map((item: { id: string }) => item.id),
      ).toContain("backup-bucket");
    });

    it("운영에서 버전 관리가 꺼져 있으면 배포를 막는다", async () => {
      process.env.NODE_ENV = "production";
      state.versioning = "disabled";

      expect(
        (await report()).summary.blockers.map((item: { id: string }) => item.id),
      ).toContain("versioning");
    });

    it("보호 상태를 읽지 못하면 IAM 권한을 의심하되 배포를 막지 않는다", async () => {
      process.env.NODE_ENV = "production";
      state.versioning = "unknown";

      const body = await report();
      const iam = body.checklist.find(
        (item: { id: string }) => item.id === "iam",
      );
      expect(iam.status).toBe("warn");
      expect(iam.detail).toContain("s3:GetBucketVersioning");
      expect(
        body.summary.blockers.map((item: { id: string }) => item.id),
      ).not.toContain("iam");
    });

    it("복원해 본 적이 없으면 복구 불가로 보고 운영 배포를 막는다", async () => {
      process.env.NODE_ENV = "production";
      state.restores = 0;

      const body = await report();
      const readinessItem = body.checklist.find(
        (item: { id: string }) => item.id === "readiness",
      );
      expect(readinessItem.status).toBe("fail");
      expect(readinessItem.detail).toContain("되살릴 수 없습니다");
      expect(
        body.summary.blockers.map((item: { id: string }) => item.id),
      ).toContain("readiness");
    });

    it("개발에서는 같은 상태로도 배포를 막지 않는다", async () => {
      delete process.env.NODE_ENV;
      state.bucketExists = false;
      state.backupBucketExists = false;
      state.versioning = "disabled";
      state.restores = 0;

      const body = await report();
      const ids = body.summary.blockers.map((item: { id: string }) => item.id);
      for (const id of ["bucket", "backup-bucket", "versioning", "readiness"]) {
        expect(ids).not.toContain(id);
      }
    });

    it("버킷 조회가 실패하면 통과로 세지 않는다", async () => {
      state.bucketExists = null as unknown as boolean;
      expect(
        (await report()).checklist.find(
          (item: { id: string }) => item.id === "bucket",
        ).status,
      ).toBe("manual");
    });
  });
});
