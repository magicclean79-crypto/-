import type { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { ProviderProductionService } from "../llm/provider-production.service";
import { PrismaService } from "../prisma/prisma.service";
import { AlertService } from "./alert.service";
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
  let seq = 0;

  return {
    alerts,
    runs,
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
      },
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

async function build(overrides: Overrides = {}) {
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
      process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/very-secret";
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
      expect(all.body).toHaveLength(3);

      await request(server)
        .post("/ops/checks/run?job=nope")
        .set("Authorization", "Bearer tok-admin")
        .expect(400);
    });
  });
});
