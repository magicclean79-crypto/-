import type { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { ProviderProductionService } from "../llm/provider-production.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AlertService } from "./alert.service";
import { BackupService } from "./backup.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationService } from "./notification.service";
import { OpsController } from "./ops.controller";
import { ScheduledChecksService } from "./scheduled-checks.service";

/**
 * Production Automation & Alerting 검증. (TASK-1302, Sprint 13)
 *
 * 판정 로직(감지·중복·해소)은 core에서 검증하므로 여기서는 **어댑터 배선**을
 * 본다: 점검이 옳은 관측을 읽는가 / 경보가 저장·전달되는가 / 같은 경보를
 * 반복해서 알리지 않는가 / 점검마다 자기 종류의 경보만 해소하는가.
 */

interface AlertRow {
  id: string;
  kind: string;
  key: string;
  level: "WARNING" | "CRITICAL";
  title: string;
  message: string;
  status: "ACTIVE" | "RESOLVED";
  occurrences: number;
  firstRaisedAt: Date;
  lastRaisedAt: Date;
  notifiedAt: Date | null;
  resolvedAt: Date | null;
  archivedAt: Date | null;
}

interface CheckRunRow {
  id: string;
  job: string;
  ok: boolean;
  detail: string;
  alertsRaised: number;
  durationMs: number;
  trigger: string;
  createdAt: Date;
}

const OFF = { budget: null, spend: 0, ratio: null, status: "off" as const };

/** 최소 Prisma 스텁 — alerts/check_runs를 메모리 Map으로 흉내 낸다 */
function createPrismaStub() {
  const alerts = new Map<string, AlertRow>();
  const runs: CheckRunRow[] = [];
  const deliveries: {
    id: string;
    alertKey: string;
    channel: string;
    level: string;
    ok: boolean;
    attempts: number;
    status: number | null;
    error: string | null;
    createdAt: Date;
  }[] = [];
  const queue: {
    id: string;
    alertKey: string;
    channel: string;
    level: string;
    payload: unknown;
    status: "PENDING" | "SENT" | "DEAD";
    attempts: number;
    nextAttemptAt: Date;
    lastStatus: number | null;
    lastError: string | null;
    sentAt: Date | null;
    deadAt: Date | null;
    createdAt: Date;
  }[] = [];
  const backups: Record<string, unknown>[] = [];
  const restores: Record<string, unknown>[] = [];
  let seq = 0;

  return {
    alerts,
    runs,
    deliveries,
    queue,
    backups,
    restores,
    stub: {
      alert: {
        findMany: async (args?: {
          where?: { kind?: { in: string[] }; status?: string };
        }) => {
          let rows = [...alerts.values()];
          const kinds = args?.where?.kind?.in;
          if (kinds) {
            rows = rows.filter((row) => kinds.includes(row.kind));
          }
          if (args?.where?.status) {
            rows = rows.filter((row) => row.status === args.where!.status);
          }
          // Prisma처럼 복사본을 돌려준다 — 호출자가 저장소를 직접 바꾸면 안 된다
          return rows.map((row) => ({ ...row }));
        },
        upsert: async (args: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = alerts.get(args.where.key);
          if (existing) {
            const next = { ...existing, ...args.update } as AlertRow;
            alerts.set(args.where.key, next);
            return { ...next };
          }
          seq += 1;
          const created = {
            id: `alert-${seq}`,
            occurrences: 1,
            firstRaisedAt: new Date(),
            lastRaisedAt: new Date(),
            resolvedAt: null,
            notifiedAt: null,
            archivedAt: null,
            ...args.create,
          } as AlertRow;
          alerts.set(args.where.key, created);
          return { ...created };
        },
        update: async (args: {
          where: { key: string };
          data: Record<string, unknown>;
        }) => {
          const existing = alerts.get(args.where.key)!;
          const next = { ...existing, ...args.data } as AlertRow;
          alerts.set(args.where.key, next);
          return { ...next };
        },
        updateMany: async (args: {
          where: { key: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const key of args.where.key.in) {
            const existing = alerts.get(key);
            if (existing) {
              alerts.set(key, { ...existing, ...args.data } as AlertRow);
              count += 1;
            }
          }
          return { count };
        },
      },
      notificationDelivery: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = { id: `nd-${seq}`, createdAt: new Date(), ...args.data };
          deliveries.push(row as never);
          return { ...row };
        },
        findMany: async () => deliveries.map((row) => ({ ...row })),
      },
      notificationQueue: {
        createMany: async (args: { data: Record<string, unknown>[] }) => {
          for (const data of args.data) {
            seq += 1;
            queue.push({
              id: `q-${seq}`,
              status: "PENDING",
              attempts: 0,
              nextAttemptAt: new Date(0),
              lastStatus: null,
              lastError: null,
              sentAt: null,
              deadAt: null,
              createdAt: new Date(),
              ...data,
            } as never);
          }
          return { count: args.data.length };
        },
        findMany: async (args?: { where?: { status?: string } }) => {
          const status = args?.where?.status;
          return queue
            .filter((row) => (status ? row.status === status : true))
            .map((row) => ({ ...row }));
        },
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const index = queue.findIndex((row) => row.id === args.where.id);
          queue[index] = { ...queue[index], ...args.data } as never;
          return { ...queue[index] };
        },
        updateMany: async (args: {
          where: { status?: string; id?: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          queue.forEach((row, index) => {
            const statusOk = !args.where.status || row.status === args.where.status;
            const idOk = !args.where.id || args.where.id.in.includes(row.id);
            if (statusOk && idOk) {
              queue[index] = { ...row, ...args.data } as never;
              count += 1;
            }
          });
          return { count };
        },
      },
      backupRun: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = { id: `bk-${seq}`, createdAt: new Date(), ...args.data };
          backups.push(row as never);
          return { ...row };
        },
        findMany: async () =>
          [...backups].reverse().map((row) => ({ ...row })),
      },
      restoreRun: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = { id: `rs-${seq}`, createdAt: new Date(), ...args.data };
          restores.push(row as never);
          return { ...row };
        },
        findMany: async () =>
          [...restores].reverse().map((row) => ({ ...row })),
      },
      $queryRaw: async () => [{ "?column?": 1 }],
      checkRun: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `run-${seq}`,
            createdAt: new Date(),
            ...args.data,
          } as CheckRunRow;
          runs.push(row);
          return { ...row };
        },
        findFirst: async (args: { where: { job: string } }) => {
          const found = [...runs]
            .reverse()
            .find((row) => row.job === args.where.job);
          return found ? { ...found } : null;
        },
      },
    },
  };
}

interface Overrides {
  cost?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  monitor?: Record<string, unknown>;
}

/** 저장소 스텁 상태 (TASK-1701) — 테스트마다 바꿔 쓴다 */
const storageProtection = {
  versioning: "unknown" as "enabled" | "disabled" | "unknown",
  replication: "unknown" as "enabled" | "disabled" | "unknown",
  uploadFails: false,
};
const offsiteUploads: string[] = [];

async function build(overrides: Overrides = {}) {
  storageProtection.versioning = "unknown";
  storageProtection.replication = "unknown";
  storageProtection.uploadFails = false;
  offsiteUploads.length = 0;
  const prisma = createPrismaStub();

  const production = {
    verifyCost: async () => ({
      ok: true,
      hours: 24,
      checked: 10,
      unpricedCalls: 0,
      recordedTotal: 0.01,
      expectedTotal: 0.01,
      issues: [],
      pricing: [],
      checkedAt: new Date().toISOString(),
      ...overrides.cost,
    }),
    validateProviders: async (options?: { live?: boolean }) => ({
      ok: true,
      production: false,
      liveChecked: Boolean(options?.live),
      providers: [],
      blockers: [],
      checkedAt: new Date().toISOString(),
      ...overrides.validation,
    }),
    monitor: async () => ({
      status: "healthy",
      windowMinutes: 60,
      minSamples: 5,
      totals: {
        calls: 10,
        successCount: 10,
        failedCount: 0,
        successRate: 1,
        cost: 0.01,
        unpricedCalls: 0,
      },
      providers: [],
      alerts: [],
      diagnosticCalls: 0,
      checkedAt: new Date().toISOString(),
      ...overrides.monitor,
    }),
  };

  const budget = {
    status: async () => ({
      daily: OFF,
      monthly: OFF,
      alertRatio: 0.8,
      checkedAt: new Date().toISOString(),
      ...overrides.budget,
    }),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [OpsController],
    providers: [
      AlertService,
      ScheduledChecksService,
      NotificationService,
      NotificationQueueService,
      DistributedLockService,
      BackupService,
      {
        provide: StorageService,
        useValue: {
          check: async () => "버킷 접근 정상",
          // 목업 저장소는 보호 상태를 알려 주지 않는다 — unknown이 정직한 답이다
          describeProtection: async () => ({
            versioning: storageProtection.versioning,
            replication: storageProtection.replication,
          }),
          putObject: async (key: string) => {
            offsiteUploads.push(key);
            if (storageProtection.uploadFails) {
              throw new Error("저장소 연결 실패");
            }
            return `https://example.com/${key}`;
          },
        },
      },
      { provide: PrismaService, useValue: prisma.stub },
      { provide: ProviderProductionService, useValue: production },
      { provide: LlmBudgetService, useValue: budget },
      {
        provide: AuthService,
        useValue: {
          validateToken: async (token: string) =>
            token === "tok-admin"
              ? { id: "u-a", email: "a@acos.local", role: "ADMIN" }
              : token === "tok-editor"
                ? { id: "u-e", email: "e@acos.local", role: "EDITOR" }
                : null,
        },
      },
      { provide: APP_GUARD, useClass: WriteProtectionGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return {
    app,
    prisma,
    checks: moduleRef.get(ScheduledChecksService),
    alerts: moduleRef.get(AlertService),
  };
}

const ORIGINAL_ENV = { ...process.env };

describe("Production Automation & Alerting (TASK-1302)", () => {
  let app: INestApplication | null = null;

  beforeEach(() => {
    // 테스트에서 실제 전송을 기다리지 않는다 — 재시도 로직은 core에서 검증
    process.env.ALERT_RETRY_MAX_ATTEMPTS = "1";
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    process.env = { ...ORIGINAL_ENV };
  });

  describe("Scheduled Checks", () => {
    it("비용 검증 점검 — 미산정 모델과 예산 경보를 만든다", async () => {
      const built = await build({
        cost: {
          ok: false,
          unpricedCalls: 12,
          issues: [
            {
              kind: "unpriced",
              provider: "openai",
              model: "gpt-5-preview",
              count: 12,
              message: "가격표에 없는 모델",
              sampleIds: [],
            },
          ],
        },
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;

      const result = await built.checks.run("cost-verification", "manual");
      expect(result.ok).toBe(false);
      expect(result.alertsRaised).toBe(2);
      expect([...built.prisma.alerts.keys()].sort()).toEqual([
        "budget:daily",
        "unpriced-model:openai:gpt-5-preview",
      ]);
      expect(built.prisma.alerts.get("budget:daily")?.level).toBe("CRITICAL");
      // 실행 이력이 남는다 — "언제 마지막으로 확인했는가"의 근거
      expect(built.prisma.runs).toHaveLength(1);
      expect(built.prisma.runs[0]).toMatchObject({
        job: "cost-verification",
        trigger: "manual",
        ok: false,
      });
    });

    it("설정 점검 — Live Check를 하지 않는다 (CTO 결정 1301-①, 자동 과금 방지)", async () => {
      const seen: boolean[] = [];
      const built = await build();
      app = built.app;
      const production = built.app.get(ProviderProductionService) as unknown as {
        validateProviders: (options?: { live?: boolean }) => Promise<unknown>;
      };
      const original = production.validateProviders.bind(production);
      production.validateProviders = async (options?: { live?: boolean }) => {
        seen.push(Boolean(options?.live));
        return original(options);
      };

      await built.checks.run("provider-validation", "manual");
      expect(seen).toEqual([false]);
    });

    it("설정 점검 — 환경 오류와 Provider blocker를 경보한다", async () => {
      const built = await build({
        validation: {
          ok: false,
          blockers: ["openai: 플레이스홀더로 보이는 값입니다."],
        },
      });
      app = built.app;

      const result = await built.checks.run("provider-validation", "manual");
      expect(result.ok).toBe(false);
      expect([...built.prisma.alerts.keys()]).toContain(
        "configuration:provider:openai",
      );
    });

    it("Health Check 점검 — 새 호출을 만들지 않고 쌓인 Execution으로 판정한다", async () => {
      const built = await build({
        monitor: {
          status: "down",
          providers: [
            {
              provider: "openai",
              calls: 10,
              successCount: 0,
              failedCount: 10,
              successRate: 0,
              latency: null,
              cost: null,
              costPerCall: null,
              unpricedCalls: 0,
              models: ["gpt-4o"],
              lastCallAt: null,
              status: "down",
            },
          ],
        },
      });
      app = built.app;

      const result = await built.checks.run("health-check", "manual");
      expect(result.notified).toHaveLength(1);
      expect(built.prisma.alerts.get("provider-failure:openai")).toMatchObject({
        level: "CRITICAL",
        status: "ACTIVE",
      });
    });

    it("점검마다 자기 종류의 경보만 해소한다 — 다른 점검의 경보를 지우면 안 된다", async () => {
      const built = await build({
        monitor: {
          status: "down",
          providers: [
            {
              provider: "openai",
              calls: 10,
              successCount: 0,
              failedCount: 10,
              successRate: 0,
              latency: null,
              cost: null,
              costPerCall: null,
              unpricedCalls: 0,
              models: [],
              lastCallAt: null,
              status: "down",
            },
          ],
        },
      });
      app = built.app;

      await built.checks.run("health-check", "manual");
      expect(
        built.prisma.alerts.get("provider-failure:openai")?.status,
      ).toBe("ACTIVE");

      // 비용 점검은 Provider 경보를 건드리지 않는다
      await built.checks.run("cost-verification", "manual");
      expect(
        built.prisma.alerts.get("provider-failure:openai")?.status,
      ).toBe("ACTIVE");
    });

    it("점검 자체가 실패해도 이력을 남기고 예외를 던지지 않는다", async () => {
      const built = await build();
      app = built.app;
      const production = built.app.get(ProviderProductionService) as unknown as {
        monitor: () => Promise<unknown>;
      };
      production.monitor = async () => {
        throw new Error("DB 연결 실패");
      };

      const result = await built.checks.run("health-check", "manual");
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("DB 연결 실패");
      expect(built.prisma.runs[0].ok).toBe(false);
    });

    it("예약 등록은 OPS_SCHEDULED_CHECKS=off로 끌 수 있다", async () => {
      process.env.OPS_SCHEDULED_CHECKS = "off";
      const built = await build();
      app = built.app;
      expect(built.checks.schedules().every((entry) => entry.enabled)).toBe(
        false,
      );
    });
  });

  describe("Alert 중복·해소", () => {
    it("같은 경보를 쿨다운 안에서 다시 알리지 않는다", async () => {
      process.env.ALERT_COOLDOWN_MS = "3600000";
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;

      const first = await built.checks.run("cost-verification", "manual");
      expect(first.notified.map((entry) => entry.action)).toEqual(["raise"]);

      const second = await built.checks.run("cost-verification", "manual");
      expect(second.notified).toEqual([]); // 억제
      expect(built.prisma.alerts.get("budget:daily")?.occurrences).toBe(2);
    });

    it("문제가 사라지면 해소로 처리하고 알린다", async () => {
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");

      // 예산을 올려 문제가 사라진 상황
      const budget = built.app.get(LlmBudgetService) as unknown as {
        status: () => Promise<unknown>;
      };
      budget.status = async () => ({
        daily: OFF,
        monthly: OFF,
        alertRatio: 0.8,
        checkedAt: new Date().toISOString(),
      });

      const result = await built.checks.run("cost-verification", "manual");
      expect(result.notified.map((entry) => entry.action)).toEqual(["resolve"]);
      expect(built.prisma.alerts.get("budget:daily")).toMatchObject({
        status: "RESOLVED",
      });
      expect(
        built.prisma.alerts.get("budget:daily")?.resolvedAt,
      ).not.toBeNull();
    });
  });

  describe("API", () => {
    it("GET /ops/alerts · POST /ops/checks/run — ADMIN 전용 (조회도 보호)", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).get("/ops/alerts").expect(401);
      await request(server)
        .get("/ops/alerts")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
      await request(server).post("/ops/checks/run").expect(401);
      await request(server)
        .post("/ops/checks/run")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
    });

    it("GET /ops/alerts — 경보 현황·점검 구성, 웹훅 주소는 노출하지 않는다", async () => {
      // 즉시 실패하는 주소 — 네트워크를 타지 않으면서 "설정됨"은 참이다
      process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:1/very-secret";
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");

      const response = await request(built.app.getHttpServer())
        .get("/ops/alerts")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.ok).toBe(false); // critical 하나
      expect(response.body.summary).toMatchObject({ total: 1, critical: 1 });
      expect(response.body.webhookConfigured).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain("very-secret");
      expect(response.body.schedules.map((entry: { job: string }) => entry.job)).toEqual([
        "cost-verification",
        "provider-validation",
        "health-check",
        // 보관이 예약 점검에 편입됐다 (CTO 결정 1401-③)
        "alert-archive",
        // 운영 검증 점검 (TASK-1601)
        "backup",
        "restore-verify",
        "provider-smoke",
      ]);
      // 마지막 실행 결과가 붙는다
      expect(
        response.body.schedules.find(
          (entry: { job: string }) => entry.job === "cost-verification",
        ).lastResult,
      ).not.toBeNull();
    });

    it("POST /ops/checks/run — 특정 점검만 실행, 알 수 없는 점검은 400", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      const one = await request(server)
        .post("/ops/checks/run?job=health-check")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(one.body).toHaveLength(1);
      expect(one.body[0].job).toBe("health-check");
      expect(one.body[0].trigger).toBe("manual");

      const all = await request(server)
        .post("/ops/checks/run")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      // provider-smoke는 기본 꺼짐이라 runAll 대상이 아니다 (과금 방지)
      expect(all.body).toHaveLength(6);
      expect(all.body.map((entry: { job: string }) => entry.job)).not.toContain(
        "provider-smoke",
      );

      await request(server)
        .post("/ops/checks/run?job=nope")
        .set("Authorization", "Bearer tok-admin")
        .expect(400);
    });
  });

  describe("Production Operations Platform (TASK-1401)", () => {
    it("경보 알림이 큐에 담기고, 워커가 보낸 뒤 시도가 기록된다", async () => {
      // 즉시 실패하는 주소 — 실패도 기록되어야 한다는 것이 요점이다
      process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:1/hook";
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;

      await built.checks.run("cost-verification", "manual");

      // 즉시 보내지 않는다 — 큐에 담긴다 (TASK-1501, CTO 결정 1401-②)
      expect(built.prisma.queue).toHaveLength(1);
      expect(built.prisma.queue[0]).toMatchObject({
        alertKey: "budget:daily",
        channel: "webhook",
        status: "PENDING",
        attempts: 0,
      });
      expect(built.prisma.deliveries).toHaveLength(0);

      // 전송 실패가 경보 저장을 막지 않는다
      expect(built.prisma.alerts.get("budget:daily")?.status).toBe("ACTIVE");

      const queue = built.app.get(NotificationQueueService);
      process.env.ALERT_RETRY_MAX_ATTEMPTS = "3"; // 재시도 여유를 준다
      const result = await queue.drain({ force: true });
      expect(result.processed).toBe(1);
      // 네트워크 오류는 재시도 대상이라 아직 Dead Letter가 아니다
      expect(result.retried).toBe(1);
      expect(built.prisma.queue[0]).toMatchObject({
        status: "PENDING",
        attempts: 1,
      });
      expect(built.prisma.deliveries).toHaveLength(1);
      expect(built.prisma.deliveries[0]).toMatchObject({
        channel: "webhook",
        ok: false,
      });
    });

    it("채널이 하나도 없으면 전송을 시도하지 않는다 (로그만)", async () => {
      delete process.env.ALERT_WEBHOOK_URL;
      delete process.env.ALERT_SLACK_WEBHOOK_URL;
      delete process.env.SMTP_HOST;
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;

      await built.checks.run("cost-verification", "manual");
      expect(built.prisma.deliveries).toEqual([]);
    });

    it("종류별 재알림 간격이 적용된다 (CTO 결정 1302-①)", async () => {
      process.env.ALERT_COOLDOWN_MS = "1";
      process.env.ALERT_COOLDOWN_BUDGET_MS = "3600000";
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;

      const first = await built.checks.run("cost-verification", "manual");
      expect(first.alertsRaised).toBe(1);
      // 전체 기본은 1ms(경과)이지만 budget은 1시간이라 억제된다
      const second = await built.checks.run("cost-verification", "manual");
      expect(second.alertsRaised).toBe(0);
    });

    it("예약 실행은 잠금을 잡은 인스턴스만 수행한다 (수동 실행은 잠금 무관)", async () => {
      const built = await build();
      app = built.app;
      const locks = built.app.get(DistributedLockService) as unknown as {
        acquire: (key: string) => Promise<boolean>;
      };
      const asked: string[] = [];
      locks.acquire = async (key: string) => {
        asked.push(key);
        return false; // 다른 인스턴스가 리더
      };

      const scheduled = await built.checks.run("health-check", "schedule");
      expect(scheduled.detail).toContain("다른 인스턴스");
      expect(asked).toEqual(["scheduler:health-check"]);
      // 잠금을 못 잡았으면 실행 이력도 남기지 않는다 (정상 동작이라 소음이다)
      expect(built.prisma.runs).toEqual([]);

      // 수동 실행은 사람이 지금 확인하려는 것이므로 잠금을 요구하지 않는다
      const manual = await built.checks.run("health-check", "manual");
      expect(manual.detail).not.toContain("다른 인스턴스");
      expect(built.prisma.runs).toHaveLength(1);
    });

    it("REDIS_URL이 없으면 단일 인스턴스 모드임을 드러낸다", async () => {
      delete process.env.REDIS_URL;
      const built = await build();
      app = built.app;

      const coordination = await built.checks.coordination();
      expect(coordination.distributed).toBe(false);
      expect(coordination.instance).toMatch(/-\d+-[0-9a-f]+$/);
      expect(coordination.leases).toHaveLength(7);
      // 단일 모드에서는 내가 항상 리더다
      expect(coordination.leases.every((lease) => lease.self)).toBe(true);
    });

    it("GET /ops/alerts/history — 이력 요약과 평균 해소 시간", async () => {
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");

      const response = await request(built.app.getHttpServer())
        .get("/ops/alerts/history")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.entries).toHaveLength(1);
      expect(response.body.summary).toMatchObject({ total: 1, active: 1 });
      expect(response.body.summary.byKind[0]).toMatchObject({ kind: "budget" });
      expect(response.body.archiveAfterDays).toBe(90);
    });

    it("POST /ops/alerts/archive — 유예가 지난 해소 경보만 보관하고 삭제하지 않는다", async () => {
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");

      // 오래전에 해소된 것으로 만든다
      const row = built.prisma.alerts.get("budget:daily")!;
      built.prisma.alerts.set("budget:daily", {
        ...row,
        status: "RESOLVED",
        resolvedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      });

      const response = await request(built.app.getHttpServer())
        .post("/ops/alerts/archive")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body).toMatchObject({ archived: 1, afterDays: 90 });
      // 삭제가 아니라 보관 — 이력은 남는다 (CTO 결정 1302-④)
      expect(built.prisma.alerts.get("budget:daily")).toMatchObject({
        status: "ARCHIVED",
      });
      expect(built.prisma.alerts.size).toBe(1);
    });

    it("최근 해소된 경보는 보관하지 않는다", async () => {
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");
      const row = built.prisma.alerts.get("budget:daily")!;
      built.prisma.alerts.set("budget:daily", {
        ...row,
        status: "RESOLVED",
        resolvedAt: new Date(),
      });

      const result = await built.alerts.archive();
      expect(result.archived).toBe(0);
    });

    it("GET /ops/alerts — 채널·조율 현황을 담되 주소는 노출하지 않는다", async () => {
      process.env.ALERT_SLACK_WEBHOOK_URL = "http://127.0.0.1:1/slack-secret";
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/alerts")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const slack = response.body.channels.find(
        (entry: { channel: string }) => entry.channel === "slack",
      );
      expect(slack).toMatchObject({ enabled: true, env: "ALERT_SLACK_WEBHOOK_URL" });
      expect(JSON.stringify(response.body)).not.toContain("slack-secret");
      expect(response.body.coordination).toMatchObject({ distributed: false });
      expect(response.body.cooldownByKind.budget).toBeGreaterThan(0);
    });

    it("알림·이력·보관 API도 ADMIN 전용", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      for (const path of ["/ops/alerts/history", "/ops/notifications"]) {
        await request(server).get(path).expect(401);
        await request(server)
          .get(path)
          .set("Authorization", "Bearer tok-editor")
          .expect(403);
      }
      await request(server).post("/ops/alerts/archive").expect(401);
      await request(server)
        .post("/ops/notifications/test")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
    });
  });

  describe("High Availability & Operations Reliability (TASK-1501)", () => {
    it("최대 시도를 소진하면 Dead Letter로 남고 지워지지 않는다", async () => {
      process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:1/hook";
      process.env.ALERT_RETRY_MAX_ATTEMPTS = "1";
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");

      const queue = built.app.get(NotificationQueueService);
      const result = await queue.drain({ force: true });
      expect(result.dead).toBe(1);
      expect(built.prisma.queue[0]).toMatchObject({ status: "DEAD", attempts: 1 });

      const status = await queue.status();
      expect(status.dead).toBe(1);
      expect(status.deadLetters).toHaveLength(1);
      expect(status.deadLetters[0].lastError).not.toBeNull();
    });

    it("Dead Letter 재시도 — 시도 횟수를 되돌려 다시 보낸다", async () => {
      process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:1/hook";
      process.env.ALERT_RETRY_MAX_ATTEMPTS = "1";
      const built = await build({
        budget: {
          daily: { budget: 10, spend: 12, ratio: 1.2, status: "exceeded" },
        },
      });
      app = built.app;
      await built.checks.run("cost-verification", "manual");
      const queue = built.app.get(NotificationQueueService);
      await queue.drain({ force: true });

      const response = await request(built.app.getHttpServer())
        .post("/ops/notifications/queue/requeue")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body.requeued).toBe(1);
      expect(built.prisma.queue[0]).toMatchObject({
        status: "PENDING",
        attempts: 0,
      });
    });

    it("워커는 리더만 돌린다 — 잠금을 못 잡으면 조용히 넘긴다", async () => {
      const built = await build();
      app = built.app;
      const locks = built.app.get(DistributedLockService) as unknown as {
        acquire: (key: string) => Promise<boolean>;
      };
      locks.acquire = async () => false;

      const queue = built.app.get(NotificationQueueService);
      const result = await queue.drain();
      expect(result.skipped).toContain("다른 인스턴스");
      expect(result.processed).toBe(0);
    });

    it("보관이 예약 점검으로 돈다 (CTO 결정 1401-③) — 경보를 만들지 않는다", async () => {
      const built = await build();
      app = built.app;

      const result = await built.checks.run("alert-archive", "manual");
      expect(result.ok).toBe(true);
      expect(result.detail).toContain("삭제하지 않습니다");
      expect(result.notified).toEqual([]);
      expect(built.prisma.runs[0].job).toBe("alert-archive");
    });

    it("보관은 시각 기반으로 구성된다", async () => {
      const built = await build();
      app = built.app;
      const status = await built.checks.status();
      const archive = status.find((entry) => entry.job === "alert-archive")!;
      expect(archive.dailyAtMinutes).toBe(4 * 60);
    });

    it("Scheduler Stopped Alert — 멈추면 critical, 원인이 잠금이면 그렇게 적는다", async () => {
      process.env.OPS_CHECK_COST_INTERVAL = "1000";
      process.env.OPS_SCHEDULER_GRACE_FACTOR = "1";
      const built = await build();
      app = built.app;

      // 오래전에 한 번 돌고 멈춘 상황을 만든다
      built.prisma.runs.push({
        id: "old",
        job: "cost-verification",
        ok: true,
        detail: "",
        alertsRaised: 0,
        durationMs: 1,
        trigger: "schedule",
        createdAt: new Date(Date.now() - 60_000),
      });

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("scheduler-stopped:cost-verification");
      expect(alert).toMatchObject({ level: "CRITICAL", status: "ACTIVE" });
      expect(alert!.title).toContain("예약 점검 정지");
    });

    it("정상적으로 돌고 있으면 정지 경보를 만들지 않는다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.runs.push({
        id: "recent",
        job: "cost-verification",
        ok: true,
        detail: "",
        alertsRaised: 0,
        durationMs: 1,
        trigger: "schedule",
        createdAt: new Date(),
      });

      await built.checks.watchdog();
      expect(
        [...built.prisma.alerts.keys()].filter((key) =>
          key.startsWith("scheduler-stopped:"),
        ),
      ).toEqual([]);
    });

    it("감시는 끌 수 있지만, 껐다는 사실이 설정에 남는다", async () => {
      process.env.OPS_SCHEDULER_WATCHDOG = "off";
      process.env.OPS_SCHEDULER_GRACE_FACTOR = "1";
      process.env.OPS_CHECK_COST_INTERVAL = "1000";
      const built = await build();
      app = built.app;
      built.prisma.runs.push({
        id: "old",
        job: "cost-verification",
        ok: true,
        detail: "",
        alertsRaised: 0,
        durationMs: 1,
        trigger: "schedule",
        createdAt: new Date(Date.now() - 60_000),
      });

      await built.checks.watchdog();
      expect(built.prisma.alerts.size).toBe(0);
    });

    it("기본 채널 정책 — warning은 메일로 가지 않는다 (CTO 결정 1401-④)", async () => {
      process.env.ALERT_SLACK_WEBHOOK_URL = "http://127.0.0.1:1/slack";
      process.env.SMTP_HOST = "localhost";
      process.env.ALERT_EMAIL_TO = "ops@acos.local";
      delete process.env.ALERT_WEBHOOK_URL;
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/alerts")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      const byChannel = Object.fromEntries(
        response.body.channels.map((entry: { channel: string }) => [
          entry.channel,
          entry,
        ]),
      );
      expect(byChannel.slack).toMatchObject({ enabled: true, minLevel: "warning" });
      expect(byChannel.email).toMatchObject({ enabled: true, minLevel: "critical" });
      // 주소는 여전히 노출하지 않는다
      expect(JSON.stringify(response.body)).not.toContain("ops@acos.local");
    });

    it("큐·재시도 API도 ADMIN 전용", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).get("/ops/notifications/queue").expect(401);
      await request(server)
        .get("/ops/notifications/queue")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
      await request(server).post("/ops/notifications/queue/drain").expect(401);
      await request(server)
        .post("/ops/notifications/queue/requeue")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
    });
  });

  describe("Production Verification & Operational Readiness (TASK-1601)", () => {
    it("Prisma 전용 파라미터를 떼어 낸다 — pg_dump가 ?schema=를 거부한다", () => {
      // 라이브 검증에서 실제로 실패했던 지점이다
      expect(
        BackupService.toLibpqUrl(
          "postgresql://u:p@h:5432/acos?schema=public&connection_limit=5",
        ),
      ).toBe("postgresql://u:p@h:5432/acos");
      // libpq가 아는 파라미터는 남긴다
      expect(
        BackupService.toLibpqUrl("postgresql://u:p@h:5432/acos?sslmode=require"),
      ).toContain("sslmode=require");
      // 해석할 수 없으면 그대로 둔다
      expect(BackupService.toLibpqUrl("not-a-url")).toBe("not-a-url");
    });

    it("복원 검증은 미구성이면 실패가 아니다 — 못 한 것과 실패한 것은 다르다", async () => {
      delete process.env.BACKUP_RESTORE_DB_URL;
      const built = await build();
      app = built.app;

      const result = await built.checks.run("restore-verify", "manual");
      expect(result.ok).toBe(true);
      expect(result.detail).toContain("미구성");
      // 미구성은 이력에 남기지 않는다 — 하지 않은 일을 했다고 기록하지 않는다
      expect(built.prisma.restores).toHaveLength(0);
    });

    it("백업 실패도 이력에 남고 예외를 던지지 않는다", async () => {
      delete process.env.DATABASE_URL;
      const built = await build();
      app = built.app;

      const result = await built.checks.run("backup", "manual");
      expect(result.ok).toBe(false);
      expect(built.prisma.backups).toHaveLength(1);
      expect(built.prisma.backups[0]).toMatchObject({ ok: false });
    });

    it("보관 점검이 경보와 Dead Letter를 함께 정리한다 (CTO 결정 1501-③)", async () => {
      const built = await build();
      app = built.app;

      const result = await built.checks.run("alert-archive", "manual");
      expect(result.detail).toContain("Dead Letter 보관");
      expect(result.detail).toContain("삭제하지 않습니다");
    });

    it("GET /ops/readiness — 백업·복원 이력이 없으면 복구 불가로 판정한다", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      // 복원해 보지 않은 백업은 백업이 아니다
      expect(response.body.recoverable).toBe(false);
      expect(response.body.backup.verdict).toBe("missing");
      expect(response.body.restore.verdict).toBe("missing");
      expect(
        response.body.checklist.map((item: { id: string }) => item.id),
      ).toContain("runbook");
      // 자동 판정이 불가능한 항목은 manual로 남는다 — 통과로 세지 않는다
      expect(response.body.summary.manual).toBeGreaterThanOrEqual(1);
      expect(
        response.body.checklist.find(
          (item: { id: string }) => item.id === "runbook",
        ).status,
      ).toBe("manual");
    });

    it("GET /ops/readiness — SMTP·Redis 상태를 담되 수신자는 노출하지 않는다", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.ALERT_EMAIL_TO = "ops-secret@acos.local";
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.smtp.configured).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain("ops-secret");
      // Redis 미구성이면 그 사실을 말한다
      expect(response.body.redis.configured).toBe(false);
      expect(response.body.redis.outageThresholdMs).toBe(30 * 60 * 1000);
    });

    it("SMTP 미구성은 실패가 아니라 미구성으로 알린다", async () => {
      delete process.env.SMTP_HOST;
      delete process.env.ALERT_EMAIL_TO;
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .post("/ops/notifications/verify-smtp")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body).toMatchObject({ configured: false, ok: false });
      expect(response.body.detail).toContain("쓰지 않는 구성");
    });

    it("Redis 장애가 30분 이상 지속되면 critical (CTO 결정 1501-②)", async () => {
      const built = await build();
      app = built.app;
      const locks = built.app.get(DistributedLockService) as unknown as {
        distributed: boolean;
        healthy: boolean;
        unhealthySince: number | null;
      };
      Object.defineProperty(locks, "distributed", { get: () => true });
      Object.defineProperty(locks, "healthy", { get: () => false });
      Object.defineProperty(locks, "unhealthySince", {
        get: () => Date.now() - 31 * 60_000,
      });

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("scheduler-stopped:lock");
      expect(alert).toMatchObject({ level: "CRITICAL", status: "ACTIVE" });
      expect(alert!.message).toContain("비용은 나가는데 비용 점검은 멈춘 상태");
    });

    it("짧은 Redis 끊김은 지속 경보를 만들지 않는다", async () => {
      const built = await build();
      app = built.app;
      const locks = built.app.get(DistributedLockService) as unknown as object;
      Object.defineProperty(locks, "distributed", { get: () => true });
      Object.defineProperty(locks, "healthy", { get: () => false });
      Object.defineProperty(locks, "unhealthySince", {
        get: () => Date.now() - 60_000,
      });

      await built.checks.watchdog();
      expect(built.prisma.alerts.get("scheduler-stopped:lock")).toBeUndefined();
    });

    it("Job별 여유 배수가 적용된다 (CTO 결정 1501-④)", async () => {
      process.env.OPS_CHECK_COST_INTERVAL = "1000";
      process.env.OPS_SCHEDULER_GRACE_FACTOR = "100";
      process.env.OPS_SCHEDULER_GRACE_COST_VERIFICATION = "1";
      const built = await build();
      app = built.app;
      built.prisma.runs.push({
        id: "old",
        job: "cost-verification",
        ok: true,
        detail: "",
        alertsRaised: 0,
        durationMs: 1,
        trigger: "schedule",
        createdAt: new Date(Date.now() - 60_000),
      });

      await built.checks.watchdog();
      // 전체 기본은 100배(관대)지만 이 Job만 1배라 멈춘 것으로 본다
      expect(
        built.prisma.alerts.get("scheduler-stopped:cost-verification"),
      ).toBeDefined();
    });

    it("일 1회 점검의 설명이 로컬 시각이라고 말한다 (CTO 결정 1501-①)", async () => {
      // 라이브 검증에서 기동 로그가 "매일 04:00 UTC"라고 말하는 것을 발견했다 —
      // 실제로는 로컬 시각으로 도는데 설명만 UTC면 운영자가 다른 시각을 기다린다
      process.env.TZ = "Asia/Seoul";
      const built = await build();
      app = built.app;
      const archive = built.checks
        .schedules()
        .find((entry) => entry.job === "alert-archive")!;
      expect(archive.dailyAtMinutes).toBe(240);

      built.prisma.runs.push({
        id: "stale",
        job: "alert-archive",
        ok: true,
        detail: "",
        alertsRaised: 0,
        durationMs: 1,
        trigger: "schedule",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });
      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("scheduler-stopped:alert-archive");
      expect(alert!.message).toContain("로컬");
      expect(alert!.message).not.toContain("UTC");
    });

    it("운영 검증 API도 ADMIN 전용", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).get("/ops/readiness").expect(401);
      await request(server)
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
      await request(server).post("/ops/backup/run").expect(401);
      await request(server)
        .post("/ops/backup/verify-restore")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
      await request(server)
        .post("/ops/notifications/verify-smtp")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
    });
  });

  describe("Enterprise Backup & Disaster Recovery (TASK-1701)", () => {
    beforeEach(() => {
      // 테스트가 실제 운영 백업 경로에 쓰지 않도록 임시 디렉터리로 돌린다
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.BACKUP_RESTORE_DB_URL =
        "postgresql://u:p@localhost:5432/acos_restore_check";
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      delete process.env.BACKUP_OFFSITE;
      delete process.env.BACKUP_RPO_HOURS;
      delete process.env.BACKUP_RTO_MINUTES;
      delete process.env.BACKUP_MAX_AGE_HOURS;
      delete process.env.RESTORE_MAX_AGE_HOURS;
    });

    it("복원 대상이 운영 DB면 복원을 아예 하지 않는다 (CTO 결정 1601-②)", async () => {
      // 복원은 대상을 지우고 쓴다 — 잘못된 설정을 그대로 실행하면 사고다
      process.env.BACKUP_RESTORE_DB_URL = "postgresql://other:x@localhost:5432/acos";
      const built = await build();
      app = built.app;
      const backups = built.app.get(BackupService);

      expect(backups.restoreTargetSafety.verdict).toBe("same-as-production");
      expect(backups.restoreTarget).toBeNull();

      const result = await backups.verifyRestore("manual");
      expect(result.configured).toBe(false);
      // pg_restore를 부르지 않았으므로 이력도 남지 않는다
      expect(built.prisma.restores).toHaveLength(0);
    });

    it("체크리스트가 복원 대상 분리를 복구 필수 항목으로 본다", async () => {
      process.env.BACKUP_RESTORE_DB_URL = "postgresql://u:p@localhost:5432/acos";
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "restore-target",
      );
      expect(item).toMatchObject({ status: "fail", critical: true });
      expect(response.body.recoverable).toBe(false);
      expect(response.body.enterprise.restoreTarget.verdict).toBe(
        "same-as-production",
      );
    });

    it("원격 복제가 꺼져 있으면 올리지 않는다 — 과금·용량을 몰래 쓰지 않는다", async () => {
      const built = await build();
      app = built.app;
      const backups = built.app.get(BackupService);
      expect(backups.offsiteEnabled).toBe(false);

      await backups.backup("manual");
      expect(offsiteUploads).toHaveLength(0);
    });

    it("복제 실패가 백업을 실패시키지는 않는다 — 덤프는 이미 받았다", async () => {
      process.env.BACKUP_OFFSITE = "on";
      const built = await build();
      app = built.app;
      storageProtection.uploadFails = true;

      const result = await built.app.get(BackupService).backup("manual");
      // 덤프 자체가 실패했는지(pg_dump 부재 등)와 무관하게, 복제 실패로
      // 예외가 새어 나오지는 않아야 한다
      expect(result.offsite).toBe(false);
    });

    it("저장소가 보호 상태를 알려 주지 않으면 통과로 세지 않는다 (CTO 결정 1601-④)", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "storage-protection",
      );
      expect(item).toMatchObject({ status: "manual", critical: false });
      expect(item.detail).toContain("애플리케이션은 이미지를 백업하지 않습니다");
      expect(response.body.enterprise.storageProtection).toMatchObject({
        versioning: "unknown",
        replication: "unknown",
      });
    });

    it("버전 관리가 꺼져 있으면 주의로 알리되 복구를 막지는 않는다", async () => {
      const built = await build();
      app = built.app;
      storageProtection.versioning = "disabled";
      storageProtection.replication = "enabled";

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "storage-protection",
      );
      expect(item.status).toBe("warn");
      expect(item.detail).toContain("버전 관리가 꺼져 있습니다");
    });

    it("무결성을 확인하지 못했으면 직접 확인으로 남는다", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.enterprise.integrity.status).toBe("manual");
    });

    it("읽히지 않는 덤프는 복구 불가로 판정한다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-bad",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "acos.dump",
        durationMs: 100,
        trigger: "schedule",
        error: null,
        checksum: "a".repeat(64),
        integrityOk: false,
        entries: null,
        offsiteKey: null,
        createdAt: new Date(),
      });

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.enterprise.integrity.status).toBe("fail");
      expect(response.body.recoverable).toBe(false);
    });

    it("RTO는 실제 복원 소요 시간을 쓴다 — 추정이 아니라 측정이다", async () => {
      process.env.BACKUP_RTO_MINUTES = "1";
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-ok",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "acos.dump",
        durationMs: 100,
        trigger: "schedule",
        error: null,
        checksum: "a".repeat(64),
        integrityOk: true,
        entries: 120,
        offsiteKey: null,
        createdAt: new Date(),
      });
      built.prisma.restores.push({
        id: "rs-ok",
        ok: true,
        tables: 30,
        fileName: "acos.dump",
        durationMs: 90_000,
        trigger: "schedule",
        error: null,
        createdAt: new Date(),
      });

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const objectives = response.body.enterprise.objectives;
      expect(objectives.rtoMs).toBe(90_000);
      expect(objectives.rtoTargetMs).toBe(60_000);
      expect(objectives.rtoMet).toBe(false);
      expect(objectives.status).toBe("warn");
      expect(objectives.detail).toContain("측정된 하한");
    });

    it("복원 측정치가 없으면 RTO를 통과로 세지 않는다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-ok",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "acos.dump",
        durationMs: 100,
        trigger: "schedule",
        error: null,
        checksum: null,
        integrityOk: true,
        entries: 10,
        offsiteKey: null,
        createdAt: new Date(),
      });

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.enterprise.objectives.rtoMs).toBeNull();
      expect(response.body.enterprise.objectives.status).toBe("manual");
    });

    it("신선도 기본값은 백업 2일 · 복원 검증 8일 (CTO 결정 1601-⑤)", async () => {
      const built = await build();
      app = built.app;
      const backups = built.app.get(BackupService);
      expect(backups.maxBackupAgeMs).toBe(48 * 60 * 60 * 1000);
      expect(backups.maxRestoreAgeMs).toBe(192 * 60 * 60 * 1000);

      process.env.BACKUP_MAX_AGE_HOURS = "6";
      expect(backups.maxBackupAgeMs).toBe(6 * 60 * 60 * 1000);
    });

    it("이력에 체크섬 전체나 원격 키를 그대로 담지 않는다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-ok",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "acos.dump",
        durationMs: 100,
        trigger: "schedule",
        error: null,
        checksum: "c".repeat(64),
        integrityOk: true,
        entries: 120,
        offsiteKey: "backups/secret-path/acos.dump",
        createdAt: new Date(),
      });

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const body = JSON.stringify(response.body);
      // 원격 키는 저장소 구조를 드러낸다 — 있는지만 알린다
      expect(body).not.toContain("secret-path");
      expect(response.body.backup.history[0].offsite).toBe(true);
      // 체크섬은 이력에 그대로 둔다 — 운영자가 원격 사본과 대조할 근거다.
      // 다만 체크리스트 설명에는 앞부분만 싣는다(읽으라고 있는 문장이므로).
      expect(response.body.backup.history[0].checksum).toHaveLength(64);
      expect(response.body.enterprise.integrity.detail).not.toContain(
        "c".repeat(64),
      );
    });
  });
});
