import type { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { resolveProvisioningPolicy, SCHEDULED_JOBS } from "@acos/core";
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
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { ContentGovernanceService } from "../content-governance/content-governance.service";
import { GovernancePreflightService } from "../content-governance/governance-preflight.service";
import { GovernanceRulesService } from "../content-governance/governance-rules.service";
import { GovernanceScanService } from "../content-governance/governance-scan.service";
import { createCompanyBrainMock } from "../content-governance/governance.spec-helpers";
import { MigrationGovernanceService } from "./migration-governance.service";
import { RecoveryDrillService } from "./recovery-drill.service";
import { RecoveryEvaluationService } from "./recovery-evaluation.service";
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

/**
 * 실제 서비스가 읽는 것과 같은 마이그레이션 디렉터리 목록 (TASK-2401).
 * 대조가 실제로 이뤄지는지 보려면 같은 목록을 써야 한다.
 */
const MIGRATION_DIRS = readdirSync(
  join(process.cwd(), "prisma", "migrations"),
  { withFileTypes: true },
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

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
  const drills: Record<string, unknown>[] = [];
  const requirements: Record<string, unknown>[] = [];
  /**
   * 스키마 적용 상태 (TASK-2401).
   *
   * 실제 서비스가 읽는 것과 같은 두 조회(`migration_name` 목록 · 실패 건수)를
   * 여기서 답한다. 목록을 돌려주지 않으면 "코드에 없는 마이그레이션" 판정이
   * 구조적으로 검증될 수 없다.
   */
  /**
   * 발행 판정 기록 (TASK-2601) — 보관 정리가 이 저장소를 건드린다.
   * `where`를 실제로 적용한다: 무시하면 "이미 보관된 것을 다시 보관하지
   * 않는다"와 "유예가 지난 것만 보관한다"가 검증되지 않는다.
   */
  const governanceChecks: {
    id: string;
    createdAt: Date;
    archivedAt: Date | null;
  }[] = [];
  /**
   * 예약 스캔 실행 기록 (TASK-2701) — 지난 결과와 비교하려면 남아 있어야
   * 한다. `where.scope`를 실제로 적용한다: 무시하면 범위별 비교가 검증되지
   * 않는다.
   */
  const governanceScanRuns: Record<string, unknown>[] = [];
  /**
   * 프로젝트와 콘텐츠 (TASK-2801) — 예약 스캔이 **프로젝트별로** 돌기 때문에
   * 목록이 실제로 필요하다. 빈 스텁을 두면 프로젝트별 스캔이 아무것도 하지
   * 않는데도 테스트가 통과한다.
   */
  const projects: { id: string; name: string }[] = [
    { id: "proj-a", name: "가 프로젝트" },
    { id: "proj-b", name: "나 프로젝트" },
  ];
  const contents: {
    id: string;
    projectId: string;
    title: string;
    body: string;
    status: string;
    createdAt: Date;
  }[] = [];
  const migrations = {
    // 기본은 **실제 디렉터리 그대로 적용됨** — 정상 상태에서 경보가 나지 않아야
    // 경보가 났을 때 그것이 신호가 된다
    applied: [...MIGRATION_DIRS] as string[] | null,
    failed: 0 as number | null,
  };
  let seq = 0;

  return {
    alerts,
    migrations,
    governanceChecks,
    governanceScanRuns,
    projects,
    contents,
    runs,
    deliveries,
    queue,
    backups,
    restores,
    drills,
    requirements,
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
        /**
         * 처음 관측한 시각 조회 (TASK-2401).
         *
         * 스텁이 이것을 답하지 않으면 `firstSeenAt`이 조용히 null이 되어
         * **경보 승격이 검증되지 않는다** — 스텁이 결함을 감추는 그 형태다.
         */
        findFirst: async (args: { where: { key: string } }) => {
          const found = [...alerts.values()]
            .filter((row) => row.key === args.where.key)
            .sort(
              (a, b) => a.firstRaisedAt.getTime() - b.firstRaisedAt.getTime(),
            )[0];
          return found ? { ...found } : null;
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
      governanceScanRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `scan-${seq}`,
            createdAt: new Date(),
            alerted: false,
            previousTotal: null,
            ...data,
          };
          governanceScanRuns.push(row);
          return { ...row };
        },
        findFirst: async (args?: { where?: { scope?: string } }) => {
          const scope = args?.where?.scope;
          const rows = governanceScanRuns.filter(
            (row) => scope === undefined || row.scope === scope,
          );
          const found = rows[rows.length - 1];
          return found ? { ...found } : null;
        },
        findMany: async (args?: {
          where?: { scope?: string };
          take?: number;
        }) => {
          const scope = args?.where?.scope;
          let rows = governanceScanRuns.filter(
            (row) => scope === undefined || row.scope === scope,
          );
          rows = rows.slice().reverse();
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({ ...row }));
        },
      },
      content: {
        /**
         * 위반 스캔이 읽는다 — `projectId`·`status`·`take`를 **실제로
         * 적용한다**(TASK-2801). 무시하면 프로젝트별 범위가 검증되지 않는다.
         */
        findMany: async (args?: {
          where?: { projectId?: string; status?: { in: string[] } };
          take?: number;
        }) => {
          let rows = [...contents];
          const projectId = args?.where?.projectId;
          if (projectId !== undefined) {
            rows = rows.filter((row) => row.projectId === projectId);
          }
          const statuses = args?.where?.status?.in;
          if (statuses) {
            rows = rows.filter((row) => statuses.includes(row.status));
          }
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({ ...row, productObject: null }));
        },
      },
      project: {
        findUnique: async (args: { where: { id: string } }) => {
          const found = projects.find((row) => row.id === args.where.id);
          return found ? { ...found } : null;
        },
        findMany: async () => projects.map((row) => ({ ...row })),
      },
      contentGovernanceCheck: {
        updateMany: async (args: {
          where: {
            archivedAt: null;
            createdAt: { lte: Date };
          };
          data: { archivedAt: Date };
        }) => {
          let count = 0;
          for (const row of governanceChecks) {
            if (
              row.archivedAt === null &&
              row.createdAt <= args.where.createdAt.lte
            ) {
              row.archivedAt = args.data.archivedAt;
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
      drillRequirement: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `req-${seq}`,
            satisfiedAt: null,
            satisfiedBy: null,
            cancelledAt: null,
            cancelledBy: null,
            cancelReason: null,
            createdAt: new Date(),
            ...args.data,
          };
          requirements.push(row as never);
          return { ...row };
        },
        findMany: async () =>
          [...requirements].reverse().map((row) => ({ ...row })),
        findUnique: async (args: { where: { id: string } }) => {
          const found = requirements.find((row) => row.id === args.where.id);
          return found ? { ...found } : null;
        },
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const index = requirements.findIndex(
            (row) => row.id === args.where.id,
          );
          requirements[index] = { ...requirements[index], ...args.data };
          return { ...requirements[index] };
        },
        updateMany: async (args: { data: Record<string, unknown> }) => {
          let count = 0;
          requirements.forEach((row, index) => {
            if (row.satisfiedAt === null && row.cancelledAt === null) {
              requirements[index] = { ...row, ...args.data };
              count += 1;
            }
          });
          return { count };
        },
      },
      recoveryDrill: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = { id: `dr-${seq}`, createdAt: new Date(), ...args.data };
          drills.push(row as never);
          return { ...row };
        },
        findMany: async () => [...drills].reverse().map((row) => ({ ...row })),
      },
      backupRun: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = { id: `bk-${seq}`, createdAt: new Date(), ...args.data };
          backups.push(row as never);
          return { ...row };
        },
        // `where`/`take`를 실제로 적용한다 — 무시하면 개수 제한 결함이 테스트를
        // 통과해 버린다 (라이브 검증에서 드러난 결함의 회귀 방지)
        findMany: async (args?: {
          where?: { createdAt?: { gte?: Date } };
          take?: number;
        }) => {
          const since = args?.where?.createdAt?.gte;
          let rows = [...backups].reverse() as { createdAt: Date }[];
          if (since) {
            rows = rows.filter((row) => row.createdAt >= since);
          }
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({ ...row }));
        },
        // 원격 대조 기록 조회 (TASK-2101)
        findFirst: async (args?: {
          where?: { remoteCheckedAt?: { not: null } };
        }) => {
          const rows = [...backups] as {
            remoteCheckedAt?: Date | null;
          }[];
          const filtered = args?.where?.remoteCheckedAt
            ? rows.filter((row) => row.remoteCheckedAt)
            : rows;
          const sorted = [...filtered].sort(
            (a, b) =>
              (b.remoteCheckedAt?.getTime() ?? 0) -
              (a.remoteCheckedAt?.getTime() ?? 0),
          );
          return sorted[0] ? { ...sorted[0] } : null;
        },
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = (backups as { id: string }[]).find(
            (entry) => entry.id === args.where.id,
          );
          if (!row) {
            throw new Error("not found");
          }
          Object.assign(row, args.data);
          return { ...row };
        },
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
      // 실제 서비스와 같이 **템플릿을 읽고** 답한다 — 무엇을 물어도 같은 값을
      // 돌려주면 마이그레이션 판정이 검증되지 않는다 (TASK-2401)
      $queryRaw: async (strings?: TemplateStringsArray) => {
        const sql = strings ? strings.join(" ") : "";
        if (sql.includes("migration_name")) {
          if (migrations.applied === null) {
            throw new Error('relation "_prisma_migrations" does not exist');
          }
          return migrations.applied.map((name) => ({ migration_name: name }));
        }
        if (sql.includes("_prisma_migrations")) {
          if (migrations.failed === null) {
            throw new Error('relation "_prisma_migrations" does not exist');
          }
          return [{ count: BigInt(migrations.failed) }];
        }
        return [{ "?column?": 1 }];
      },
      $queryRawUnsafe: async (sql: string) =>
        sql.includes("pg_database_size")
          ? [{ size: BigInt(2 * 1024 ** 3) }]
          : [],
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
  /** 원격 사본이 사라진 상태 (TASK-2201) */
  remoteMissing: false,
};

/**
 * 원격 사본으로 돌려줄 내용과 그 체크섬 (TASK-2101·2201).
 *
 * 해시를 역산할 수 없으므로, **내용을 고정하고 그 해시를 기록 체크섬으로
 * 쓴다** — 그래야 대조가 실제로 이뤄지는지를 볼 수 있다.
 */
const REMOTE_OBJECT = Buffer.from("acos-test-dump");
const REMOTE_CHECKSUM = createHash("sha256").update(REMOTE_OBJECT).digest("hex");
const offsiteUploads: string[] = [];

async function build(overrides: Overrides = {}) {
  storageProtection.versioning = "unknown";
  storageProtection.remoteMissing = false;
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
      RecoveryDrillService,
      // 복구 판정의 단일 원천 (TASK-2401, 결정 2301-①) — 컨트롤러가 이것을 쓴다
      RecoveryEvaluationService,
      MigrationGovernanceService,
      // 발행 판정 기록 보관이 예약 정리 작업에 편입됐다 (TASK-2601)
      ContentGovernanceService,
      GovernanceRulesService,
      // 예약 위반 스캔 (TASK-2701) — 예약 점검에 편입됐다
      GovernanceScanService,
      GovernancePreflightService,
      {
        provide: CompanyBrainService,
        // 예약 스캔이 실제로 위반을 잡아야 경보 경로가 검증된다 (TASK-2801)
        useValue: createCompanyBrainMock({ bannedWords: ["1위"] }),
      },
      {
        provide: StorageService,
        useValue: {
          check: async () => "버킷 접근 정상",
          // 목업 저장소는 보호 상태를 알려 주지 않는다 — unknown이 정직한 답이다
          bucket: "acos",
          backupBucket: "acos-backups",
          // 프로비저닝 경계 (TASK-2201) — 실제 서비스와 같이 환경을 읽는다
          get provisioning() {
            return resolveProvisioningPolicy(
              process.env as Record<string, string | undefined>,
            );
          },
          describeProtection: async () => ({
            versioning: storageProtection.versioning,
            replication: storageProtection.replication,
          }),
          describeBackupProtection: async () => ({
            versioning: storageProtection.versioning,
            replication: storageProtection.replication,
          }),
          putBackupObject: async (key: string) => {
            offsiteUploads.push(key);
            if (storageProtection.uploadFails) {
              throw new Error("저장소 연결 실패");
            }
            return `acos-backups/${key}`;
          },
          /**
           * 원격 사본 내려받기 (TASK-2101·2201).
           *
           * 내용을 고정하고 그 해시(`REMOTE_CHECKSUM`)를 기록 체크섬으로
           * 쓴다 — 그래야 대조가 실제로 이뤄지는지를 볼 수 있다.
           */
          getBackupObject: async (key: string) => {
            if (storageProtection.remoteMissing) {
              throw new Error(`객체를 찾을 수 없습니다: ${key}`);
            }
            return REMOTE_OBJECT;
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
    // 복구 판정·스키마 상태의 단일 원천 (TASK-2401)
    recovery: moduleRef.get(RecoveryEvaluationService),
    migrations: moduleRef.get(MigrationGovernanceService),
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
        // 원격 사본 대조 (TASK-2101, CTO 결정 2001-②)
        "remote-verify",
        // 발행 위반 예약 스캔 (TASK-2701, CTO 결정 2601-②)
        "governance-scan",
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
      // provider-smoke는 기본 꺼짐이라 runAll 대상이 아니다 (과금 방지).
      // 위반 스캔이 추가돼 7종이 돈다 (TASK-2701)
      expect(all.body).toHaveLength(7);
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
      expect(coordination.leases).toHaveLength(SCHEDULED_JOBS.length);
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
      expect(item.detail).toContain("운영 저장소 표준은 Amazon S3이며");
      expect(item.detail).not.toContain("저장소가 버전");
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

  describe("Enterprise Operations Platform (TASK-1801)", () => {
    beforeEach(() => {
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      process.env.BACKUP_RESTORE_DB_URL =
        "postgresql://u:p@localhost:5432/acos_restore_check";
      delete process.env.OPS_DRILL_INTERVAL_DAYS;
      delete process.env.OPS_DRILL_GRACE_DAYS;
      delete process.env.BACKUP_RPO_HOURS;
      delete process.env.OPS_CHECK_BACKUP_INTERVAL;
      delete process.env.NODE_ENV;
    });

    it("백업 예약이 1시간 간격이 되었다 (CTO 결정 1701-①)", async () => {
      const built = await build();
      app = built.app;
      const backup = built.checks
        .schedules()
        .find((entry) => entry.job === "backup")!;
      expect(backup.dailyAtMinutes).toBeNull();
      expect(backup.intervalMs).toBe(60 * 60 * 1000);
    });

    it("손실 한도 목표가 백업 간격을 따라간다", async () => {
      const built = await build();
      app = built.app;
      const backups = built.app.get(BackupService);
      // 기본 1시간 간격 → 목표 2시간
      expect(backups.rpoTargetMs).toBe(2 * 60 * 60 * 1000);

      process.env.OPS_CHECK_BACKUP_INTERVAL = "15m";
      expect(backups.rpoTargetMs).toBe(30 * 60 * 1000);

      // 명시적으로 지정하면 그 값이 이긴다
      process.env.BACKUP_RPO_HOURS = "6";
      expect(backups.rpoTargetMs).toBe(6 * 60 * 60 * 1000);
    });

    it("원격 복제는 이미지 버킷이 아니라 백업 버킷에 올린다 (CTO 결정 1701-②)", async () => {
      process.env.BACKUP_OFFSITE = "on";
      const built = await build();
      app = built.app;

      await built.app.get(BackupService).backup("manual");
      // putObject(이미지 경로)가 아니라 putBackupObject가 불린다
      expect(offsiteUploads.every((key) => key.startsWith("backups/"))).toBe(true);

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body.enterprise.backupBucket).toMatchObject({
        name: "acos-backups",
        separated: true,
      });
      delete process.env.BACKUP_OFFSITE;
    });

    it("운영에서 버전 관리가 꺼져 있으면 복구 필수 항목이 실패한다 (CTO 결정 1701-③)", async () => {
      process.env.NODE_ENV = "production";
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
      expect(item.status).toBe("fail");
      expect(item.detail).toContain("운영 필수");
      delete process.env.NODE_ENV;
    });

    it("운영에서도 조회 불가 저장소는 직접 확인으로 남는다 (CTO 결정 1701-③)", async () => {
      process.env.NODE_ENV = "production";
      const built = await build();
      app = built.app;
      // 기본 스텁은 unknown이다

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.enterprise.storageProtection.status).toBe("manual");
      delete process.env.NODE_ENV;
    });

    it("리허설 기록이 없으면 직접 확인으로 남고 경보하지 않는다", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body.enterprise.drill.status).toBe("manual");
      expect(response.body.enterprise.drill.intervalDays).toBe(90);

      await built.checks.watchdog();
      expect(built.prisma.alerts.get("recovery-drill:overdue")).toBeUndefined();
    });

    it("리허설을 기록하면 체크리스트가 통과로 바뀐다 (CTO 결정 1701-⑤)", async () => {
      const built = await build();
      app = built.app;

      await request(built.app.getHttpServer())
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: true, performedBy: "운영자 A", durationMs: 900_000 })
        .expect(201);

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "drill",
      );
      expect(item).toMatchObject({ status: "pass", critical: false });
      expect(response.body.enterprise.drill.history[0].performedBy).toBe(
        "운영자 A",
      );
    });

    it("실패한 리허설도 기록하고 심각 경보를 만든다", async () => {
      const built = await build();
      app = built.app;

      await request(built.app.getHttpServer())
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({
          ok: false,
          performedBy: "운영자 B",
          findings: "복원 대상 DB 권한이 없었다",
        })
        .expect(201);

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("recovery-drill:failed");
      expect(alert).toMatchObject({ level: "CRITICAL", status: "ACTIVE" });
      expect(alert!.message).toContain("사고가 나기 전에 고치세요");
    });

    it("기한을 넘기면 주의 경보를 만든다 — 지금 죽는 문제는 아니다", async () => {
      process.env.OPS_DRILL_INTERVAL_DAYS = "1";
      process.env.OPS_DRILL_GRACE_DAYS = "1";
      const built = await build();
      app = built.app;
      built.prisma.drills.push({
        id: "dr-old",
        ok: true,
        performedBy: "운영자 C",
        durationMs: null,
        findings: null,
        notes: null,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("recovery-drill:overdue");
      expect(alert).toMatchObject({ level: "WARNING" });
      expect(alert!.message).not.toContain("**");
    });

    it("리허설 경보가 예약 점검 경보를 해소하지 않는다", async () => {
      // 종류를 나눠 동기화하지 않으면 한쪽이 다른 쪽을 지운다
      const built = await build();
      app = built.app;
      built.prisma.alerts.set("scheduler-stopped:cost-verification", {
        id: "a-1",
        kind: "scheduler-stopped",
        key: "scheduler-stopped:cost-verification",
        level: "CRITICAL",
        title: "예약 점검 정지",
        message: "멈춤",
        status: "ACTIVE",
        occurrences: 1,
        firstRaisedAt: new Date(),
        lastRaisedAt: new Date(),
        notifiedAt: new Date(),
        resolvedAt: null,
        archivedAt: null,
      });

      await request(built.app.getHttpServer())
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: false, performedBy: "운영자 D" })
        .expect(201);
      await built.checks.watchdog();

      expect(built.prisma.alerts.get("recovery-drill:failed")?.status).toBe(
        "ACTIVE",
      );
    });

    it("누가 했는지 없으면 기록을 거절한다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: true })
        .expect(400);
      // 성공/실패를 안 적으면 기록의 핵심이 빠진다
      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ performedBy: "운영자 E" })
        .expect(400);
    });

    it("리허설 API도 ADMIN 전용", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).get("/ops/drills").expect(401);
      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-editor")
        .send({ ok: true, performedBy: "x" })
        .expect(403);
    });
  });

  describe("Enterprise Recovery Assurance (TASK-1901)", () => {
    beforeEach(() => {
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      process.env.BACKUP_RESTORE_DB_URL =
        "postgresql://u:p@localhost:5432/acos_restore_check";
      delete process.env.NODE_ENV;
      delete process.env.OPS_DRILL_INTERVAL_DAYS;
    });

    const backupRun = (durationMs: number, minutesAgo: number) => ({
      id: `bk-${minutesAgo}`,
      ok: true,
      sizeBytes: BigInt(50_000),
      fileName: "acos.dump",
      durationMs,
      trigger: "schedule",
      error: null,
      checksum: "a".repeat(64),
      integrityOk: true,
      entries: 120,
      offsiteKey: null,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    });

    it("백업 소요 시간이 체크리스트에 들어온다 (CTO 결정 1801-①)", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(backupRun(900, 1));

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "backup-performance",
      );
      expect(item).toMatchObject({ status: "pass", critical: false });
      expect(response.body.enterprise.performance).toMatchObject({
        level: "normal",
        latestMs: 900,
      });
    });

    it("10초 초과가 연속 3회면 경보를 만든다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(
        backupRun(12_000, 1),
        backupRun(11_000, 2),
        backupRun(15_000, 3),
      );

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("backup-performance:duration");
      expect(alert).toMatchObject({ level: "WARNING", status: "ACTIVE" });
      expect(alert!.message).toContain("3회 연속");
    });

    it("30초를 넘기면 한 번만으로 심각 경보", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(backupRun(35_000, 1));

      await built.checks.watchdog();
      expect(built.prisma.alerts.get("backup-performance:duration")).toMatchObject({
        level: "CRITICAL",
      });
    });

    it("2~10초는 경보하지 않는다 — 화면에만 드러낸다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(backupRun(5_000, 1));

      await built.checks.watchdog();
      expect(
        built.prisma.alerts.get("backup-performance:duration"),
      ).toBeUndefined();

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body.enterprise.performance.level).toBe("warning");
    });

    it("백업 성능 경보가 예약 점검 경보를 해소하지 않는다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(backupRun(35_000, 1));
      built.prisma.alerts.set("scheduler-stopped:cost-verification", {
        id: "a-1",
        kind: "scheduler-stopped",
        key: "scheduler-stopped:cost-verification",
        level: "CRITICAL",
        title: "예약 점검 정지",
        message: "멈춤",
        status: "ACTIVE",
        occurrences: 1,
        firstRaisedAt: new Date(),
        lastRaisedAt: new Date(),
        notifiedAt: new Date(),
        resolvedAt: null,
        archivedAt: null,
      });

      await built.checks.watchdog();
      expect(built.prisma.alerts.get("backup-performance:duration")?.status).toBe(
        "ACTIVE",
      );
    });

    it("백업 버킷도 보호 체크리스트에 들어온다 (CTO 결정 1801-③)", async () => {
      const built = await build();
      app = built.app;
      storageProtection.versioning = "enabled";
      storageProtection.replication = "disabled";

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const ids = response.body.checklist.map((entry: { id: string }) => entry.id);
      expect(ids).toContain("storage-protection");
      expect(ids).toContain("backup-bucket-protection");

      // 어느 버킷 이야기인지 문구로 구분된다
      const backupItem = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "backup-bucket-protection",
      );
      expect(backupItem.detail).toContain("백업 버킷");
      expect(response.body.enterprise.backupBucket.protection).toMatchObject({
        versioning: "enabled",
        replication: "disabled",
      });
    });

    it("변경 사건을 등록하면 기한이 남아도 리허설이 실패로 바뀐다 (CTO 결정 1801-⑤)", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: true, performedBy: "운영자 A" })
        .expect(201);
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({
          trigger: "dr-change",
          description: "복구 절차에서 복원 대상 DB가 바뀜",
          registeredBy: "운영자 A",
        })
        .expect(201);

      const response = await request(server)
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body.enterprise.drill.status).toBe("fail");
      expect(response.body.enterprise.drill.pendingTriggers).toEqual([
        "dr-change",
      ]);
      expect(response.body.enterprise.drill.detail).toContain(
        "재해 복구 절차 변경",
      );
    });

    it("성공한 리허설이 변경 사건을 해소한다 — 실패한 리허설은 해소하지 않는다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({
          trigger: "pitr-adoption",
          description: "PITR 도입",
          registeredBy: "운영자 B",
        })
        .expect(201);

      // 실패한 리허설은 "확인했다"가 아니라 "안 되더라"는 뜻이다
      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: false, performedBy: "운영자 B" })
        .expect(201);
      expect(built.prisma.requirements[0].satisfiedAt).toBeNull();

      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: true, performedBy: "운영자 B" })
        .expect(201);
      expect(built.prisma.requirements[0].satisfiedAt).not.toBeNull();

      const response = await request(server)
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(response.body.enterprise.drill.status).toBe("pass");
    });

    it("변경 사건 경보는 리허설 실패 경보와 섞이지 않는다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: false, performedBy: "운영자 C" })
        .expect(201);
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({
          trigger: "db-major-change",
          description: "테이블 대규모 변경",
          registeredBy: "운영자 C",
        })
        .expect(201);

      await built.checks.watchdog();
      // 실패가 더 무겁다 — 제목과 본문이 어긋나면 안 된다
      const failed = built.prisma.alerts.get("recovery-drill:failed");
      expect(failed).toMatchObject({ level: "CRITICAL", status: "ACTIVE" });
      expect(failed!.message).toContain("사고가 나기 전에 고치세요");
      expect(built.prisma.alerts.get("recovery-drill:trigger")).toBeUndefined();
    });

    it("알 수 없는 종류·설명 누락은 거절한다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "무엇인가", description: "x", registeredBy: "y" })
        .expect(400);
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", registeredBy: "y" })
        .expect(400);
    });

    it("변경 사건 API도 ADMIN 전용", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).get("/ops/drills/requirements").expect(401);
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-editor")
        .send({ trigger: "dr-change", description: "x", registeredBy: "y" })
        .expect(403);
    });
  });

  describe("Enterprise Backup Integrity Platform (TASK-2001)", () => {
    beforeEach(() => {
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      process.env.BACKUP_RESTORE_DB_URL =
        "postgresql://u:p@localhost:5432/acos_restore_check";
      delete process.env.NODE_ENV;
      process.env.S3_ENDPOINT = "http://localhost:9000";
    });

    const backupAt = (hoursAgo: number, id = `bk-${hoursAgo}`) => ({
      id,
      ok: true,
      sizeBytes: BigInt(50_000),
      fileName: `acos-${hoursAgo}.dump`,
      durationMs: 300,
      trigger: "schedule",
      error: null,
      checksum: "a".repeat(64),
      integrityOk: true,
      entries: 120,
      offsiteKey: null,
      createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    });

    it("사슬에 공백이 있으면 복구 필수 항목이 실패한다", async () => {
      const built = await build();
      app = built.app;
      // 24시간 중 3개뿐 — 개별 백업은 모두 성공이다
      built.prisma.backups.push(backupAt(23), backupAt(22), backupAt(1));
      const backups = built.app.get(BackupService);
      // 기동 시각을 과거로 돌려 관측 창을 확보한다
      Object.defineProperty(backups, "startedAt", {
        value: Date.now() - 24 * 60 * 60 * 1000,
      });

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "backup-chain",
      );
      expect(item).toMatchObject({ status: "fail", critical: true });
      expect(response.body.recoverable).toBe(false);
      expect(response.body.enterprise.backupIntegrity.chain.actual).toBe(3);
    });

    it("창 안의 기록은 개수로 자르지 않는다 — 자르면 없는 공백이 생긴다", async () => {
      // 20초 간격 라이브 검증에서 창 안 4320건 중 500건만 읽혀
      // 21시간짜리 가짜 공백이 보고됐다
      const built = await build();
      app = built.app;
      process.env.OPS_CHECK_BACKUP_INTERVAL = "60s";
      const minute = 60 * 1000;
      for (let index = 0; index < 1440; index += 1) {
        built.prisma.backups.push({
          ...backupAt(0, `bk-min-${index}`),
          createdAt: new Date(Date.now() - index * minute),
        } as never);
      }
      const backups = built.app.get(BackupService);
      Object.defineProperty(backups, "startedAt", {
        value: Date.now() - 24 * 60 * 60 * 1000,
      });

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      delete process.env.OPS_CHECK_BACKUP_INTERVAL;
      const chain = response.body.enterprise.backupIntegrity.chain;
      // 500건으로 잘렸다면 창의 앞 15시간이 통째로 비어 공백으로 보고된다
      expect(chain.actual).toBe(1440);
      expect(chain.status).toBe("pass");
    });

    it("사슬 공백은 심각 경보를 만든다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(backupAt(23), backupAt(1));
      const backups = built.app.get(BackupService);
      Object.defineProperty(backups, "startedAt", {
        value: Date.now() - 24 * 60 * 60 * 1000,
      });

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("backup-integrity:chain");
      expect(alert).toMatchObject({ level: "CRITICAL", status: "ACTIVE" });
      expect(alert!.message).toContain("복구할 수 없습니다");
    });

    it("원격 사본은 조회에서 내려받지 않는다 — 전송 비용이 든다", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.enterprise.backupIntegrity.remote).toMatchObject({
        verdict: "unchecked",
        status: "manual",
      });
      expect(
        response.body.enterprise.backupIntegrity.remote.detail,
      ).toContain("전송 비용");
    });

    it("데이터베이스 규모가 재평가 기준 아래면 통과한다 (CTO 결정 1901-④)", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const scale = response.body.enterprise.backupIntegrity.scale;
      expect(scale.status).toBe("pass");
      expect(scale.bytes).toBe(2 * 1024 ** 3);
      expect(scale.nextMilestone).toBe(10 * 1024 ** 3);
    });

    it("운영에서 S3가 아니면 저장소 표준이 실패한다 (CTO 결정 1901-③)", async () => {
      process.env.NODE_ENV = "production";
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const item = response.body.checklist.find(
        (entry: { id: string }) => entry.id === "storage-standard",
      );
      expect(item).toMatchObject({ status: "fail", critical: false });
      expect(item.detail).toContain("Sprint 20부터 운영 표준은 Amazon S3");
      // 표준 미달은 복구 가능 판정을 막지 않는다 — 차단 목록에 없어야 한다
      const blockers = response.body.checklist
        .filter((entry: { critical: boolean; status: string }) =>
          entry.critical && entry.status === "fail",
        )
        .map((entry: { id: string }) => entry.id);
      expect(blockers).not.toContain("storage-standard");
      delete process.env.NODE_ENV;
    });

    it("개발에서는 개발 저장소가 정상이다", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      expect(
        response.body.enterprise.backupIntegrity.storageStandard.status,
      ).toBe("pass");
    });

    it("같은 종류가 미해소면 중복 등록을 막는다 (CTO 결정 1901-⑤)", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "절차 변경", registeredBy: "A" })
        .expect(201);
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "또 변경", registeredBy: "A" })
        .expect(409);
      // 다른 종류는 등록된다
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "pitr-adoption", description: "PITR", registeredBy: "A" })
        .expect(201);
    });

    it("요구는 취소만 가능하고 기록은 남는다 (CTO 결정 1901-②)", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      const created = await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "잘못 등록", registeredBy: "A" })
        .expect(201);

      await request(server)
        .post(`/ops/drills/requirements/${created.body.id}/cancel`)
        .set("Authorization", "Bearer tok-admin")
        .send({ cancelledBy: "운영자 B", reason: "중복 등록이었음" })
        .expect(200);

      // 기록은 남는다 — 삭제하지 않는다
      expect(built.prisma.requirements).toHaveLength(1);
      expect(built.prisma.requirements[0].cancelReason).toBe("중복 등록이었음");

      const response = await request(server)
        .get("/ops/readiness")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);
      // 취소된 요구는 미해소로 세지 않는다
      expect(response.body.enterprise.drill.pendingTriggers).toEqual([]);
    });

    it("취소 후에는 같은 종류를 다시 등록할 수 있다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      const created = await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "1차", registeredBy: "A" })
        .expect(201);
      await request(server)
        .post(`/ops/drills/requirements/${created.body.id}/cancel`)
        .set("Authorization", "Bearer tok-admin")
        .send({ cancelledBy: "A", reason: "오등록" })
        .expect(200);
      await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "2차", registeredBy: "A" })
        .expect(201);
    });

    it("취소 사유 없이는 취소할 수 없다 — 왜 취소했는지가 남아야 한다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      const created = await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "x", registeredBy: "A" })
        .expect(201);
      await request(server)
        .post(`/ops/drills/requirements/${created.body.id}/cancel`)
        .set("Authorization", "Bearer tok-admin")
        .send({ cancelledBy: "A" })
        .expect(400);
    });

    it("이미 해소된 요구는 취소할 수 없다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      const created = await request(server)
        .post("/ops/drills/require")
        .set("Authorization", "Bearer tok-admin")
        .send({ trigger: "dr-change", description: "x", registeredBy: "A" })
        .expect(201);
      await request(server)
        .post("/ops/drills")
        .set("Authorization", "Bearer tok-admin")
        .send({ ok: true, performedBy: "A" })
        .expect(201);

      await request(server)
        .post(`/ops/drills/requirements/${created.body.id}/cancel`)
        .set("Authorization", "Bearer tok-admin")
        .send({ cancelledBy: "A", reason: "늦음" })
        .expect(409);
    });

    it("원격 사본 검증·취소 API도 ADMIN 전용", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).post("/ops/backup/verify-remote").expect(401);
      await request(server)
        .post("/ops/drills/requirements/x/cancel")
        .set("Authorization", "Bearer tok-editor")
        .send({ cancelledBy: "a", reason: "b" })
        .expect(403);
    });
  });

  describe("Enterprise Operational Automation (TASK-2101)", () => {
    beforeEach(() => {
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      delete process.env.NODE_ENV;
      delete process.env.BACKUP_CHAIN_WINDOW_HOURS;
      delete process.env.OPS_CHECK_BACKUP_INTERVAL;
      delete process.env.OPS_CHECK_REMOTE_VERIFY_INTERVAL;
      process.env.S3_ENDPOINT = "http://localhost:9000";
    });

    afterEach(() => {
      delete process.env.BACKUP_CHAIN_WINDOW_HOURS;
      delete process.env.OPS_CHECK_BACKUP_INTERVAL;
      delete process.env.OPS_CHECK_REMOTE_VERIFY_INTERVAL;
    });

    const readiness = async (built: Awaited<ReturnType<typeof build>>) =>
      (
        await request(built.app.getHttpServer())
          .get("/ops/readiness")
          .set("Authorization", "Bearer tok-admin")
          .expect(200)
      ).body;

    it("관측 창을 환경변수로 설정한다 (CTO 결정 2001-①)", async () => {
      process.env.BACKUP_CHAIN_WINDOW_HOURS = "48";
      const built = await build();
      app = built.app;

      const chain = (await readiness(built)).enterprise.backupIntegrity.chain;
      expect(chain.windowMs).toBe(48 * 60 * 60 * 1000);
      expect(chain.windowSource).toBe("env");
    });

    it("간격의 4배에 못 미치는 창은 올리고, 올렸다고 말한다", async () => {
      process.env.OPS_CHECK_BACKUP_INTERVAL = "6h";
      process.env.BACKUP_CHAIN_WINDOW_HOURS = "12";
      const built = await build();
      app = built.app;

      const chain = (await readiness(built)).enterprise.backupIntegrity.chain;
      expect(chain.windowMs).toBe(24 * 60 * 60 * 1000);
      expect(chain.windowSource).toBe("clamped");
      expect(chain.windowDetail).toContain("올렸습니다");
    });

    it("사슬 판정이 설정한 창을 실제로 쓴다", async () => {
      // 30시간 전에만 백업이 있다 — 24시간 창에서는 창 안 0건이다
      process.env.BACKUP_CHAIN_WINDOW_HOURS = "48";
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-old",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "old.dump",
        durationMs: 300,
        trigger: "schedule",
        error: null,
        checksum: "a".repeat(64),
        integrityOk: true,
        entries: 120,
        offsiteKey: null,
        remoteCheckedAt: null,
        remoteVerdict: null,
        createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      } as never);
      const backups = built.app.get(BackupService);
      Object.defineProperty(backups, "startedAt", {
        value: Date.now() - 48 * 60 * 60 * 1000,
      });

      const chain = (await readiness(built)).enterprise.backupIntegrity.chain;
      // 24시간 창이었다면 0건이었을 백업이 창 안에 들어온다
      expect(chain.actual).toBe(1);
    });

    it("원격 대조는 운영에서 주 1회 예약된다 (CTO 결정 2001-②)", async () => {
      process.env.NODE_ENV = "production";
      const built = await build();
      app = built.app;

      const remote = (await readiness(built)).enterprise.backupIntegrity.remote;
      expect(remote.scheduled).toBe(true);
      expect(remote.intervalMs).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("운영이 아니면 예약되지 않는다 — 개발이 전송 비용을 낼 이유가 없다", async () => {
      const built = await build();
      app = built.app;
      expect(
        (await readiness(built)).enterprise.backupIntegrity.remote.scheduled,
      ).toBe(false);
    });

    it("대조 결과를 기록하고, 조회는 기록을 읽는다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-remote",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "acos.dump",
        durationMs: 300,
        trigger: "schedule",
        error: null,
        checksum: "a".repeat(64),
        integrityOk: true,
        entries: 120,
        offsiteKey: "backups/acos.dump",
        remoteCheckedAt: null,
        remoteVerdict: null,
        createdAt: new Date(),
      } as never);

      await request(built.app.getHttpServer())
        .post("/ops/backup/verify-remote")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      const row = (built.prisma.backups as { remoteVerdict?: string }[]).find(
        (entry) => entry.remoteVerdict !== null,
      );
      expect(row?.remoteVerdict).toBeTruthy();

      // 조회는 다시 내려받지 않고 **기록**을 읽는다
      const remote = (await readiness(built)).enterprise.backupIntegrity.remote;
      expect(remote.checkedAt).not.toBeNull();
      expect(remote.verdict).not.toBe("unchecked");
    });

    it("예약 점검으로도 대조가 돈다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-sched",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "acos.dump",
        durationMs: 300,
        trigger: "schedule",
        error: null,
        checksum: "a".repeat(64),
        integrityOk: true,
        entries: 120,
        offsiteKey: "backups/acos.dump",
        remoteCheckedAt: null,
        remoteVerdict: null,
        createdAt: new Date(),
      } as never);

      const result = await built.checks.run("remote-verify", "manual");
      expect(result.detail).toBeTruthy();
      const row = (
        built.prisma.backups as { id: string; remoteVerdict?: string }[]
      ).find((entry) => entry.id === "bk-sched");
      expect(row?.remoteVerdict).toBeTruthy();
    });

    it("기록된 대조 실패는 감시가 경보로 올린다 — 감시가 전송 비용을 만들지 않는다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push({
        id: "bk-missing",
        ok: true,
        sizeBytes: BigInt(50_000),
        fileName: "gone.dump",
        durationMs: 300,
        trigger: "schedule",
        error: null,
        checksum: "a".repeat(64),
        integrityOk: true,
        entries: 120,
        offsiteKey: "backups/gone.dump",
        remoteCheckedAt: new Date(),
        remoteVerdict: "missing",
        createdAt: new Date(),
      } as never);

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get("backup-integrity:remote");
      expect(alert).toMatchObject({ level: "CRITICAL", status: "ACTIVE" });
    });

    it("주 1회를 '604800초'라고 적지 않는다 — 아무도 읽을 수 없다", async () => {
      // 기동 로그와 경보 문구가 같은 표기를 쓴다 (라이브 검증에서 드러난 결함)
      process.env.NODE_ENV = "production";
      const built = await build();
      app = built.app;
      // 예약이 멎은 것으로 만들어 경보 문구에 간격 표기를 태운다
      Object.defineProperty(built.checks, "startedAt", {
        value: Date.now() - 90 * 24 * 60 * 60 * 1000,
      });

      await built.checks.watchdog();
      const alert = built.prisma.alerts.get(
        "scheduler-stopped:remote-verify",
      );
      expect(alert?.message).toContain("7일");
      expect(alert?.message).not.toContain("604800초");
    });

    it("재기동 후 자동 등록 결과를 화면에서 확인할 수 있다 (CTO 결정 2001-④)", async () => {
      const built = await build();
      app = built.app;

      const auto = (await readiness(built)).enterprise.drill.autoRegistration;
      expect(auto.checkedAt).not.toBeNull();
      // 확인은 했고, 등록할 것이 있었는지가 분명하게 남는다
      expect(auto.registered === null).toBe(false);
      expect(auto.detail.length).toBeGreaterThan(0);
    });
  });

  describe("Enterprise Production Readiness (TASK-2201)", () => {
    beforeEach(() => {
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      delete process.env.NODE_ENV;
      delete process.env.BACKUP_CHAIN_WINDOW_HOURS;
      delete process.env.OPS_CHECK_BACKUP_INTERVAL;
      process.env.S3_ENDPOINT = "http://localhost:9000";
    });

    afterEach(() => {
      delete process.env.BACKUP_CHAIN_WINDOW_HOURS;
      delete process.env.OPS_CHECK_BACKUP_INTERVAL;
    });

    const offsiteBackup = (id: string, minutesAgo: number) => ({
      id,
      ok: true,
      sizeBytes: BigInt(50_000),
      fileName: `${id}.dump`,
      durationMs: 300,
      trigger: "schedule",
      error: null,
      checksum: REMOTE_CHECKSUM,
      integrityOk: true,
      entries: 120,
      offsiteKey: `backups/${id}.dump`,
      remoteCheckedAt: null,
      remoteVerdict: null,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    });

    const readiness = async (built: Awaited<ReturnType<typeof build>>) =>
      (
        await request(built.app.getHttpServer())
          .get("/ops/readiness")
          .set("Authorization", "Bearer tok-admin")
          .expect(200)
      ).body;

    it("수동 대조는 최근 3건까지 본다 (CTO 결정 2101-①)", async () => {
      const built = await build();
      app = built.app;
      for (const [index, id] of ["bk-a", "bk-b", "bk-c", "bk-d"].entries()) {
        built.prisma.backups.push(offsiteBackup(id, 4 - index) as never);
      }

      const response = await request(built.app.getHttpServer())
        .post("/ops/backup/verify-remote?count=3")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.checked).toBe(3);
      expect(response.body.status).toBe("pass");
      expect(response.body.entries).toHaveLength(3);
      // 건마다 기록이 남는다 — 어느 백업이 온전한지가 복구 시점 선택의 근거다
      const recorded = (
        built.prisma.backups as { remoteVerdict?: string | null }[]
      ).filter((entry) => entry.remoteVerdict);
      expect(recorded).toHaveLength(3);
    });

    it("3건을 넘겨 요청해도 3건까지만 본다", async () => {
      const built = await build();
      app = built.app;
      for (const [index, id] of ["bk-a", "bk-b", "bk-c", "bk-d"].entries()) {
        built.prisma.backups.push(offsiteBackup(id, 4 - index) as never);
      }

      const response = await request(built.app.getHttpServer())
        .post("/ops/backup/verify-remote?count=99")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.checked).toBe(3);
    });

    it("숫자가 아닌 count는 거절한다", async () => {
      const built = await build();
      app = built.app;
      await request(built.app.getHttpServer())
        .post("/ops/backup/verify-remote?count=전부")
        .set("Authorization", "Bearer tok-admin")
        .expect(400);
    });

    it("기본은 1건 — 자동과 같은 비용으로 돈다", async () => {
      const built = await build();
      app = built.app;
      built.prisma.backups.push(offsiteBackup("bk-a", 1) as never);
      built.prisma.backups.push(offsiteBackup("bk-b", 2) as never);

      const response = await request(built.app.getHttpServer())
        .post("/ops/backup/verify-remote")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      expect(response.body.checked).toBe(1);
    });

    it("예약(자동)은 여전히 1건만 본다 (CTO 결정 2101-①)", async () => {
      const built = await build();
      app = built.app;
      for (const [index, id] of ["bk-a", "bk-b", "bk-c"].entries()) {
        built.prisma.backups.push(offsiteBackup(id, 3 - index) as never);
      }

      await built.checks.run("remote-verify", "manual");
      const recorded = (
        built.prisma.backups as { remoteVerdict?: string | null }[]
      ).filter((entry) => entry.remoteVerdict);
      expect(recorded).toHaveLength(1);
    });

    it("관측 창 상향이 Readiness에 Warning으로 드러난다 (CTO 결정 2101-②)", async () => {
      process.env.OPS_CHECK_BACKUP_INTERVAL = "6h";
      process.env.BACKUP_CHAIN_WINDOW_HOURS = "12";
      const built = await build();
      app = built.app;

      const body = await readiness(built);
      const item = body.checklist.find(
        (entry: { id: string }) => entry.id === "chain-window",
      );
      expect(item).toMatchObject({ status: "warn", critical: false });
      expect(item.detail).toContain("기동을 막지는 않습니다");
      // 경고일 뿐 복구 가능성을 낮추지 않는다
      expect(
        body.checklist.filter(
          (entry: { critical: boolean; status: string }) =>
            entry.critical && entry.status === "fail",
        ).map((entry: { id: string }) => entry.id),
      ).not.toContain("chain-window");
    });

    it("정상 설정이면 통과하고 조용하다", async () => {
      const built = await build();
      app = built.app;
      const item = (await readiness(built)).checklist.find(
        (entry: { id: string }) => entry.id === "chain-window",
      );
      expect(item.status).toBe("pass");
    });

    it("해석할 수 없는 값도 기동을 막지 않고 Warning으로 남는다", async () => {
      process.env.BACKUP_CHAIN_WINDOW_HOURS = "이십사";
      const built = await build();
      app = built.app;

      const body = await readiness(built);
      const item = body.checklist.find(
        (entry: { id: string }) => entry.id === "chain-window",
      );
      expect(item.status).toBe("warn");
      expect(body.enterprise.backupIntegrity.chain.windowSource).toBe("invalid");
    });

    it("운영에서는 앱이 버킷을 만들지 않는다고 밝힌다 (CTO 결정 2101-④)", async () => {
      process.env.NODE_ENV = "production";
      const built = await build();
      app = built.app;

      const provisioning = (await readiness(built)).enterprise
        .storageProvisioning;
      expect(provisioning.mode).toBe("external");
      expect(provisioning.detail).toContain("운영 담당자가 준비합니다");
    });

    it("개발에서는 앱이 준비한다고 밝힌다", async () => {
      const built = await build();
      app = built.app;
      expect(
        (await readiness(built)).enterprise.storageProvisioning.mode,
      ).toBe("managed");
    });
  });

  describe("Enterprise Operational Compliance Platform (TASK-2401)", () => {
    beforeEach(() => {
      process.env.BACKUP_DIR = join(tmpdir(), "acos-backup-test");
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/acos";
      delete process.env.NODE_ENV;
      process.env.S3_ENDPOINT = "http://localhost:9000";
    });

    const readiness = async (built: Awaited<ReturnType<typeof build>>) =>
      (
        await request(built.app.getHttpServer())
          .get("/ops/readiness")
          .set("Authorization", "Bearer tok-admin")
          .expect(200)
      ).body;

    describe("복구 판정 단일 원천 (CTO 결정 2301-①)", () => {
      it("조회와 판정 입구가 같은 답을 낸다", async () => {
        const built = await build();
        app = built.app;
        const recovery = built.recovery;

        const body = await readiness(built);
        // 배포 체크리스트가 쓰는 입구와 화면이 보여 주는 값이 **같아야** 한다.
        // 다르면 한 화면은 복구 가능이라 하고 다른 화면은 아니라고 한다.
        expect(await recovery.recoverable()).toBe(body.recoverable);
      });

      it("복구 불가 상태에서도 두 답이 함께 움직인다", async () => {
        // 버전 관리가 꺼진 운영 저장소는 복구 필수 항목을 실패시킨다
        process.env.NODE_ENV = "production";
        const built = await build();
        app = built.app;
        // build()가 보호 상태를 초기화하므로 그 뒤에 바꾼다 — 순서를 뒤집으면
        // 의도한 이유가 아닌 다른 이유로 통과한다
        storageProtection.versioning = "disabled";

        const body = await readiness(built);
        expect(body.recoverable).toBe(false);
        expect(await built.recovery.recoverable()).toBe(false);
      });

      it("판정 조립이 한 곳에 있다 — 체크리스트 항목도 같은 것을 쓴다", async () => {
        const built = await build();
        app = built.app;

        const evaluated = await built.recovery.evaluate();
        const body = await readiness(built);
        expect(evaluated.checklist.map((item) => item.id)).toEqual(
          body.checklist.map((item: { id: string }) => item.id),
        );
        expect(evaluated.summary.recoverable).toBe(body.recoverable);
      });
    });

    describe("코드에 없는 마이그레이션 경보 (CTO 결정 2301-②)", () => {
      const UNKNOWN = "20260909000000_from_other_branch";

      it("정상 상태에서는 경보하지 않는다", async () => {
        const built = await build();
        app = built.app;

        await built.checks.watchdog();
        expect(
          [...built.prisma.alerts.values()].filter(
            (row) => row.kind === "migration-governance",
          ),
        ).toHaveLength(0);
      });

      it("스키마가 코드보다 앞서면 주의 경보를 만든다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = [...MIGRATION_DIRS, UNKNOWN];

        await built.checks.watchdog();
        const alert = built.prisma.alerts.get("migration-governance:unknown");
        expect(alert?.level).toBe("WARNING");
        expect(alert?.status).toBe("ACTIVE");
        expect(alert?.message).toContain(UNKNOWN);
      });

      it("7일을 넘기면 심각으로 올린다 — 되돌린 것이 아니라 잊은 것이다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = [...MIGRATION_DIRS, UNKNOWN];

        await built.checks.watchdog();
        // 처음 관측 시각을 8일 전으로 되돌린다 — 경보 저장소가 관측 기록이다
        const stored = built.prisma.alerts.get("migration-governance:unknown")!;
        stored.firstRaisedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

        await built.checks.watchdog();
        const escalated = built.prisma.alerts.get(
          "migration-governance:unknown",
        );
        expect(escalated?.level).toBe("CRITICAL");
        expect(escalated?.message).toContain("8일째");
        expect(escalated?.message).toContain("배포는 막지 않습니다");
      });

      it("심각으로 올라도 배포를 막지 않는다 — 판정은 주의로 남는다", async () => {
        process.env.NODE_ENV = "production";
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = [...MIGRATION_DIRS, UNKNOWN];

        const judged = await built.migrations.judge(true);
        // 경보와 차단은 다르다 — 막으면 되돌린 배포를 다시 되돌릴 수 없다
        expect(judged.status).toBe("warn");
        expect(judged.pending).toEqual([]);
        expect(judged.unknown).toEqual([UNKNOWN]);
      });

      it("코드로 되살리면 경보가 해소된다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = [...MIGRATION_DIRS, UNKNOWN];
        await built.checks.watchdog();

        built.prisma.migrations.applied = [...MIGRATION_DIRS];
        await built.checks.watchdog();
        expect(
          built.prisma.alerts.get("migration-governance:unknown")?.status,
        ).toBe("RESOLVED");
      });

      it("마이그레이션 경보가 예약 점검 경보를 해소하지 않는다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = [...MIGRATION_DIRS, UNKNOWN];

        await built.checks.watchdog();
        const kinds = new Set(
          [...built.prisma.alerts.values()]
            .filter((row) => row.status === "ACTIVE")
            .map((row) => row.kind),
        );
        // 종류가 다른 경보는 서로를 건드리지 않는다 (결정 1302-③)
        expect(kinds.has("migration-governance")).toBe(true);
        expect(
          [...built.prisma.alerts.values()].filter(
            (row) =>
              row.kind === "scheduler-stopped" && row.status === "RESOLVED",
          ).length,
        ).toBe(0);
      });
    });

    describe("스키마 상태를 한 곳에서 읽는다 (CTO 결정 2301-④)", () => {
      it("미적용 마이그레이션은 실제 개수로 나온다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = MIGRATION_DIRS.slice(0, -2);

        const judged = await built.migrations.judge(true);
        expect(judged.status).toBe("fail");
        expect(judged.pending).toEqual(MIGRATION_DIRS.slice(-2));
      });

      it("적용 기록을 읽지 못하면 통과로 세지 않는다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = null;

        const judged = await built.migrations.judge(true);
        expect(judged.status).toBe("manual");
        expect(judged.pending).toEqual([]);
      });

      it("확인 불가 상태에서는 경보도 만들지 않는다 — 모르는 것으로 사람을 부르지 않는다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.migrations.applied = null;

        await built.checks.watchdog();
        expect(
          built.prisma.alerts.get("migration-governance:unknown"),
        ).toBeUndefined();
      });
    });
  });
  describe("Enterprise Governance Intelligence Platform (TASK-2801)", () => {
    /** 위반 본문 / 통과 본문 */
    const BANNED = "업계 1위 매트";
    const CLEAN = "깨끗한 매트";

    function seed(
      prisma: ReturnType<typeof createPrismaStub>,
      rows: { id: string; projectId: string; body: string; title?: string }[],
    ): void {
      prisma.contents.length = 0;
      for (const row of rows) {
        prisma.contents.push({
          id: row.id,
          projectId: row.projectId,
          title: row.title ?? row.id,
          body: row.body,
          status: "REVIEW",
          createdAt: new Date(),
        });
      }
    }

    describe("프로젝트별 예약 스캔 (CTO 결정 2701-③)", () => {
      it("한 번 돌면 프로젝트마다 + 전체 범위로 기록이 남는다", async () => {
        const built = await build();
        app = built.app;
        seed(built.prisma, [
          { id: "c-a1", projectId: "proj-a", body: BANNED },
          { id: "c-b1", projectId: "proj-b", body: CLEAN },
        ]);

        const result = await built.checks.run("governance-scan", "schedule");

        expect(result.ok).toBe(true);
        expect(result.detail).toContain("프로젝트 2개 + 전체 범위 스캔");
        expect(
          built.prisma.governanceScanRuns.map((row) => row.scope),
        ).toEqual(["project:proj-a", "project:proj-b", "all"]);
        // 첫 실행은 기준선이므로 경보하지 않는다 (결정 2601-③ 유지)
        expect(result.notified).toEqual([]);
      });

      it("나빠진 프로젝트만 경보하고, 전체 경보와 키가 다르다", async () => {
        const built = await build();
        app = built.app;
        seed(built.prisma, [
          { id: "c-a1", projectId: "proj-a", body: CLEAN },
          { id: "c-b1", projectId: "proj-b", body: CLEAN },
        ]);
        await built.checks.run("governance-scan", "schedule"); // 기준선 0건

        built.prisma.contents[1].body = BANNED; // proj-b만 나빠진다
        const result = await built.checks.run("governance-scan", "schedule");

        expect(result.notified.map((entry) => entry.key).sort()).toEqual([
          "governance-scan:violations:all",
          "governance-scan:violations:project:proj-b",
        ]);
        // 나아지지도 나빠지지도 않은 proj-a는 경보가 없다
        expect(
          built.prisma.alerts.get("governance-scan:violations:project:proj-a"),
        ).toBeUndefined();
      });
    });

    describe("프로젝트별 Alert와 독립 Cooldown (CTO 결정 2701-④)", () => {
      it("한 프로젝트의 해소가 다른 프로젝트의 경보를 지우지 않는다", async () => {
        const built = await build();
        app = built.app;
        seed(built.prisma, [
          { id: "c-a1", projectId: "proj-a", body: CLEAN },
          { id: "c-b1", projectId: "proj-b", body: CLEAN },
        ]);
        await built.checks.run("governance-scan", "schedule"); // 기준선 0·0

        built.prisma.contents[1].body = BANNED; // proj-b 위반
        await built.checks.run("governance-scan", "schedule");
        expect(
          built.prisma.alerts.get("governance-scan:violations:project:proj-b")
            ?.status,
        ).toBe("ACTIVE");

        // proj-b는 고쳐지고 proj-a가 나빠진다 — 전체 총량은 1건 그대로다
        built.prisma.contents[1].body = CLEAN;
        built.prisma.contents[0].body = BANNED;
        await built.checks.run("governance-scan", "schedule");

        expect(
          built.prisma.alerts.get("governance-scan:violations:project:proj-b")
            ?.status,
        ).toBe("RESOLVED");
        expect(
          built.prisma.alerts.get("governance-scan:violations:project:proj-a")
            ?.status,
        ).toBe("ACTIVE");
        // 전체 범위는 이번에 판정하지 않았다(총량 그대로) — 건드리지 않는다.
        // 좁히지 않으면 위반이 남아 있는데도 여기서 해소된다.
        expect(
          built.prisma.alerts.get("governance-scan:violations:all")?.status,
        ).toBe("ACTIVE");
      });

      it("모두 조용한 실행은 경보 저장소를 아예 건드리지 않는다", async () => {
        const built = await build();
        app = built.app;
        seed(built.prisma, [{ id: "c-a1", projectId: "proj-a", body: BANNED }]);
        await built.checks.run("governance-scan", "schedule"); // 기준선 1건

        const result = await built.checks.run("governance-scan", "schedule");
        expect(result.notified).toEqual([]);
        expect(built.prisma.alerts.size).toBe(0);
      });
    });

    describe("경보에 담기는 것 (CTO 결정 2701-⑤)", () => {
      it("증가 수와 새로 위반된 콘텐츠를 함께 담는다", async () => {
        const built = await build();
        app = built.app;
        seed(built.prisma, [
          { id: "c-a1", projectId: "proj-a", body: CLEAN, title: "매트 상세" },
          { id: "c-a2", projectId: "proj-a", body: CLEAN, title: "세제 상세" },
        ]);
        await built.checks.run("governance-scan", "schedule");

        built.prisma.contents[1].body = BANNED;
        await built.checks.run("governance-scan", "schedule");

        const alert = built.prisma.alerts.get(
          "governance-scan:violations:project:proj-a",
        )!;
        expect(alert.message).toContain("0건에서 1건으로 1건 늘었습니다");
        expect(alert.message).toContain("새로 위반된 콘텐츠 1건");
        expect(alert.message).toContain("세제 상세(c-a2)");
        // 제목에 범위가 있어야 여러 건이 왔을 때 구분된다
        expect(alert.title).toContain("가 프로젝트");
        expect(alert.title).toContain("proj-a");
        expect(alert.title).not.toContain("**");
      });
    });
  });
});
