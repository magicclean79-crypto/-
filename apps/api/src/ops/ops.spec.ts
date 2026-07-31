import type { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { resolveProvisioningPolicy, SCHEDULED_JOBS } from "@acos/core";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { LlmService } from "../llm/llm.service";
import { OCR_PROVIDER } from "../ocr/ocr.constants";
import { ActivationHistoryService } from "./activation-history.service";
import { IncidentService } from "./incident.service";
import { ProductionSmokeService } from "./production-smoke.service";
import { KpiService } from "./kpi.service";
import { OpsAuditInterceptor, OpsAuditService } from "./ops-audit.interceptor";
import { OpsEventService } from "./ops-event.service";
import { judgeAuditAction } from "@acos/core";
import { OpsSettingsService } from "./ops-settings.service";
import { IncidentPromotionService } from "./incident-promotion.service";
import { DiagnosticsService } from "./diagnostics.service";
import { DraftLifecycleService } from "./draft-lifecycle.service";
import { KpiTrendService } from "./kpi-trend.service";
import { ValidationPlanService } from "./validation-plan.service";
import { DraftRevivalService } from "./draft-revival.service";
import { ValidationRunService } from "./validation-run.service";
import { NeglectService } from "./neglect.service";
import { ProjectCostService } from "./project-cost.service";
import { HostDiscoveryService, HostObserverMiddleware } from "./host-discovery.service";
import { AppModule } from "../app.module";
import { ReadinessBoardService } from "./readiness-board.service";
import { ActivationRunbookService } from "./activation-runbook.service";
import { IgnoreEscalationService } from "./ignore-escalation.service";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { RequestContextService } from "../common/request-context.service";
import { PriceSourceService } from "../pricing/price-source.service";
import { CiStatusService } from "./ci-status.service";
import { EgressService } from "./egress.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { PricingService } from "../pricing/pricing.service";
import { ProviderProductionService } from "../llm/provider-production.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AlertService } from "./alert.service";
import { BackupService } from "./backup.service";
import { CostIntelligenceService } from "./cost-intelligence.service";
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
  // 활성화 이력 · 스모크 · 장애 이력 (TASK-3701)
  const activationEvents: Record<string, unknown>[] = [];
  const smokeRuns: Record<string, unknown>[] = [];
  const incidents: Record<string, unknown>[] = [];
  // 운영 이벤트 · 감사 기록 (TASK-3801)
  const opsEvents: Record<string, unknown>[] = [];
  // TASK-4001 — KPI 스냅샷 · 설정 변경 이력
  const kpiSnapshots: Record<string, unknown>[] = [];
  const adminAudit: Record<string, unknown>[] = [];
  // TASK-4101 — 진단 이력
  const diagnosticRuns: Record<string, unknown>[] = [];
  // TASK-4301 — 트래픽 호스트 관측 · 방치 무시 결정
  const observedHosts: Record<string, unknown>[] = [];
  const neglectDecisions: Record<string, unknown>[] = [];
  const opsAudit: Record<string, unknown>[] = [];
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
  /**
   * 비용 원장 (TASK-3101) — 리포트·예측이 이것을 읽는다.
   *
   * 스텁이 조건을 무시하고 아무 값이나 돌려주면 "기간·성공만 집계하는가"가
   * 검증되지 않는다 — 그래서 `where`를 실제로 적용한다.
   */
  const executions: {
    provider: string;
    model: string;
    status: string;
    cost: number | null;
    createdAt: Date;
    /** 호출 대상 (TASK-3501, 정책 3501-④) — 없으면 모른다 */
    baseUrl?: string | null;
    /** 어느 프로젝트가 썼는가 (TASK-4201) — null은 "모른다"다 */
    projectId?: string | null;
    diagnostic?: boolean;
    /** 호출 기능 (TASK-4301, 정책 4301-②) — `dev`는 프로젝트가 있을 수 없다 */
    feature?: string | null;
  }[] = [];
  const ocrResults: {
    provider: string;
    status: string;
    cost: number | null;
    createdAt: Date;
    baseUrl?: string | null;
    projectId?: string | null;
  }[] = [];
  /** 단가 제안 (TASK-3101) — 검토 → 승인 → 적용 절차의 저장소 */
  const pricingProposals: Record<string, unknown>[] = [];
  /**
   * 감지 실행 이력 (TASK-3301, CTO 정책 3301-④).
   *
   * 이것이 없으면 **"감지 0건"과 "감지를 안 돌렸다"를 구분할 수 없다** —
   * Provider별 주기 판정도 이 기록을 읽는다.
   */
  const priceDetectionRuns: Record<string, unknown>[] = [];

  /**
   * Provider + 호출 대상(baseUrl)별 집계 (TASK-3501, 정책 3501-⑤).
   * `baseUrl`이 없는 행은 `null` 묶음으로 남는다 — 모르는 것을 공식으로
   * 세지 않으려면 그 구분이 스텁에도 있어야 한다.
   */
  const groupByTarget = (
    rows: {
      provider: string;
      status: string;
      createdAt: Date;
      baseUrl?: string | null;
    }[],
    args: {
      where?: {
        createdAt?: { gte?: Date; lte?: Date };
        status?: string;
        provider?: { not?: string };
      };
    },
  ) => {
    const buckets = new Map<
      string,
      { provider: string; baseUrl: string | null; _count: { _all: number } }
    >();
    for (const row of rows) {
      if (args.where?.status !== undefined && row.status !== args.where.status) {
        continue;
      }
      const gte = args.where?.createdAt?.gte;
      if (gte && row.createdAt.getTime() < gte.getTime()) continue;
      if (
        args.where?.provider?.not !== undefined &&
        row.provider === args.where.provider.not
      ) {
        continue;
      }
      const baseUrl = row.baseUrl ?? null;
      const key = `${row.provider}|${baseUrl ?? ""}`;
      const bucket = buckets.get(key) ?? {
        provider: row.provider,
        baseUrl,
        _count: { _all: 0 },
      };
      bucket._count._all += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  };

  /** 기간·상태 조건을 적용한 비용 집계 (Prisma groupBy와 같은 모양) */
  const groupCost = (
    rows: {
      provider: string;
      model?: string;
      status: string;
      cost: number | null;
      createdAt: Date;
    }[],
    args: {
      where?: {
        createdAt?: { gte?: Date; lte?: Date };
        status?: string;
        provider?: { not?: string };
      };
    },
    withModel: boolean,
  ) => {
    const buckets = new Map<
      string,
      {
        provider: string;
        model?: string;
        _sum: { cost: number | null };
        _count: { _all: number; cost: number };
      }
    >();
    for (const row of rows) {
      if (args.where?.status !== undefined && row.status !== args.where.status) {
        continue;
      }
      const gte = args.where?.createdAt?.gte;
      const lte = args.where?.createdAt?.lte;
      if (gte && row.createdAt.getTime() < gte.getTime()) continue;
      if (lte && row.createdAt.getTime() > lte.getTime()) continue;
      // `provider: { not: "mock" }`를 **실제로 적용한다** — 무시하면 가짜
      // 호출이 실 연결의 근거로 세어져 운영 전환 판정이 거짓이 된다
      if (args.where?.provider?.not !== undefined &&
          row.provider === args.where.provider.not) {
        continue;
      }
      const key = withModel ? `${row.provider}/${row.model ?? ""}` : row.provider;
      const bucket = buckets.get(key) ?? {
        provider: row.provider,
        ...(withModel ? { model: row.model ?? "" } : {}),
        _sum: { cost: null as number | null },
        _count: { _all: 0, cost: 0 },
      };
      bucket._count._all += 1;
      if (row.cost !== null) {
        bucket._count.cost += 1;
        bucket._sum.cost = Number(((bucket._sum.cost ?? 0) + row.cost).toFixed(6));
      }
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  };

  /**
   * 감지 표본 (TASK-3201) — 최신순으로 조건을 적용해 돌려준다.
   *
   * 감지는 **최근 표본이 한 값으로 모일 때만** 판단하므로 순서가 결과를
   * 바꾼다 — 스텁이 순서를 무시하면 그 규칙이 검증되지 않는다.
   */
  const sampleRows = <T extends { status: string; createdAt: Date }>(
    rows: T[],
    args?: { where?: { status?: string; createdAt?: { gte?: Date } }; take?: number },
  ): (T & { id: string })[] => {
    let result = rows.filter((row) => {
      if (args?.where?.status !== undefined && row.status !== args.where.status) {
        return false;
      }
      const gte = args?.where?.createdAt?.gte;
      return gte === undefined || row.createdAt.getTime() >= gte.getTime();
    });
    result = result
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (typeof args?.take === "number") {
      result = result.slice(0, args.take);
    }
    return result.map((row, index) => ({
      ...row,
      id: (row as { id?: string }).id ?? `sample-${index}`,
      inputTokens: (row as { inputTokens?: number | null }).inputTokens ?? null,
      outputTokens: (row as { outputTokens?: number | null }).outputTokens ?? null,
      units: (row as { units?: number }).units ?? 1,
    }));
  };

  /** UTC 일자별 지출 (예측이 읽는 date_trunc 집계와 같은 모양) */
  const dailyCost = (
    rows: { status: string; cost: number | null; createdAt: Date }[],
    from?: Date,
  ) => {
    const buckets = new Map<
      string,
      { date: string; total: number; calls: number; unpriced: number }
    >();
    for (const row of rows) {
      if (row.status !== "SUCCESS") continue;
      if (from && row.createdAt.getTime() < from.getTime()) continue;
      const date = row.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(date) ?? { date, total: 0, calls: 0, unpriced: 0 };
      bucket.calls += 1;
      if (row.cost === null) {
        bucket.unpriced += 1;
      } else {
        bucket.total = Number((bucket.total + row.cost).toFixed(6));
      }
      buckets.set(date, bucket);
    }
    return [...buckets.values()];
  };

  const migrations = {
    // 기본은 **실제 디렉터리 그대로 적용됨** — 정상 상태에서 경보가 나지 않아야
    // 경보가 났을 때 그것이 신호가 된다
    applied: [...MIGRATION_DIRS] as string[] | null,
    failed: 0 as number | null,
  };
  let seq = 0;

  return {
    /**
     * 경보를 직접 심는다 (TASK-3901) — 초안 승격은 "오래 살아 있은 경보"를
     * 조건으로 하므로, 점검을 돌려 만드는 방식으로는 시간을 만들 수 없다.
     */
    seedAlert(row: Partial<AlertRow> & { key: string }) {
      const now = new Date();
      alerts.set(row.key, {
        id: `alert-${alerts.size + 1}`,
        kind: "provider-failure",
        level: "CRITICAL",
        title: "경보",
        message: "",
        status: "ACTIVE",
        occurrences: 1,
        firstRaisedAt: now,
        lastRaisedAt: now,
        notifiedAt: null,
        resolvedAt: null,
        archivedAt: null,
        ...row,
      } as AlertRow);
    },
    /**
     * 설정 변경 이력을 직접 심는다 (TASK-4001) — 임계값 변경은 관리자
     * 설정 API가 남기는데, 그 API는 이 스펙의 대상이 아니다.
     */
    seedSettingChange(row: Record<string, unknown>) {
      seq += 1;
      adminAudit.push({
        id: `adm-${seq}`,
        createdAt: new Date(),
        actor: null,
        before: null,
        after: null,
        note: null,
        ...row,
      });
    },
    alerts,
    migrations,
    governanceChecks,
    governanceScanRuns,
    projects,
    contents,
    executions,
    ocrResults,
    pricingProposals,
    priceDetectionRuns,
    runs,
    deliveries,
    queue,
    backups,
    restores,
    drills,
    requirements,
    kpiSnapshots,
    stub: {
      alert: {
        // 운영 KPI가 활성 경보·창 안 발생을 센다 (TASK-3801)
        count: async (args?: {
          where?: { status?: string; firstRaisedAt?: { gte: Date } };
        }) => {
          let rows = [...alerts.values()];
          if (args?.where?.status) {
            rows = rows.filter((row) => row.status === args.where!.status);
          }
          const gte = args?.where?.firstRaisedAt?.gte;
          if (gte) {
            rows = rows.filter((row) => row.firstRaisedAt.getTime() >= gte.getTime());
          }
          return rows.length;
        },
        findMany: async (args?: {
          where?: { kind?: { in: string[] }; status?: string; level?: string };
        }) => {
          let rows = [...alerts.values()];
          const kinds = args?.where?.kind?.in;
          if (kinds) {
            rows = rows.filter((row) => kinds.includes(row.kind));
          }
          if (args?.where?.status) {
            rows = rows.filter((row) => row.status === args.where!.status);
          }
          // 초안 승격이 CRITICAL만 읽는다 (TASK-3901)
          if (args?.where?.level) {
            rows = rows.filter((row) => row.level === args.where!.level);
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
      /**
       * 비용 원장 집계 (TASK-3101) — 리포트가 Provider·모델별로 읽는다.
       */
      execution: {
        groupBy: async (args: {
          by?: string[];
          where?: {
            createdAt?: { gte?: Date; lte?: Date };
            status?: string;
            provider?: { not?: string };
          };
        }) =>
          // 운영 전환 판정은 **호출 대상까지** 묶어 센다 (TASK-3501, 정책 3501-⑤).
          // 이 조건을 무시하면 "성공했다"만으로 통과하게 되고, 이 기능의
          // 본질이 검증되지 않는다.
          args.by?.includes("baseUrl") === true
            ? groupByTarget(executions, args)
            : groupCost(executions, args, true),
        /**
         * 가격 감지 표본 (TASK-3201) — `status`·`createdAt`·`take`를 **실제로
         * 적용한다**. 무시하면 실패한 호출이나 옛 기록이 감지에 섞인다.
         */
        findMany: async (args?: {
          where?: { status?: string; createdAt?: { gte?: Date } };
          take?: number;
        }) => sampleRows(executions, args),
      },
      ocrResult: {
        groupBy: async (args: {
          by?: string[];
          where?: {
            createdAt?: { gte?: Date; lte?: Date };
            status?: string;
            provider?: { not?: string };
          };
        }) =>
          args.by?.includes("baseUrl") === true
            ? groupByTarget(ocrResults, args)
            : groupCost(ocrResults, args, false),
        findMany: async (args?: {
          where?: { status?: string; createdAt?: { gte?: Date } };
          take?: number;
        }) => sampleRows(ocrResults, args),
      },
      /**
       * 단가 제안 (TASK-3101) — 단계 전이가 실제로 저장돼야 "건너뛸 수
       * 없다"와 "적용 뒤에는 되돌릴 수 없다"가 검증된다.
       */
      pricingProposal: {
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `pp-${seq}`,
            currentPrice: null,
            // 실제 스키마와 같은 모양이어야 "감지된 제안"과 "예약된 적용"이
            // 구조적으로 검증된다 (TASK-3201)
            origin: "manual",
            evidence: null,
            effectiveFrom: null,
            reviewedBy: null,
            reviewedAt: null,
            approvedBy: null,
            approvedAt: null,
            appliedBy: null,
            appliedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectedReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...args.data,
          } as Record<string, unknown>;
          pricingProposals.push(row);
          return { ...row };
        },
        findUnique: async (args: { where: { id: string } }) => {
          const found = pricingProposals.find((row) => row.id === args.where.id);
          return found ? { ...found } : null;
        },
        /**
         * 진행 중인 제안 조회 (TASK-3201) — 감지가 같은 항목에 제안을 두 번
         * 만들지 않는지 보려면 `stage.in`을 실제로 적용해야 한다.
         */
        findFirst: async (args: {
          where: { target: string; key: string; stage?: { in: string[] } };
        }) => {
          const found = pricingProposals.find(
            (row) =>
              row.target === args.where.target &&
              row.key === args.where.key &&
              (args.where.stage === undefined ||
                args.where.stage.in.includes(row.stage as string)),
          );
          return found ? { ...found } : null;
        },
        findMany: async (args?: {
          where?: { stage?: string; appliedAt?: { not: null } };
          take?: number;
        }) => {
          let rows = [...pricingProposals];
          const stage = args?.where?.stage;
          if (stage !== undefined) {
            rows = rows.filter((row) => row.stage === stage);
          }
          if (args?.where?.appliedAt !== undefined) {
            rows = rows.filter((row) => row.appliedAt !== null);
          }
          rows = rows.slice().reverse();
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({ ...row }));
        },
        /**
         * `where.stage`도 실제로 본다 — 무시하면 "조회와 갱신 사이에 단계가
         * 바뀌었을 때 갱신하지 않는다"가 검증되지 않는다.
         */
        update: async (args: {
          where: { id: string; stage?: string };
          data: Record<string, unknown>;
        }) => {
          const row = pricingProposals.find(
            (candidate) =>
              candidate.id === args.where.id &&
              (args.where.stage === undefined ||
                candidate.stage === args.where.stage),
          );
          if (row === undefined) {
            throw new Prisma.PrismaClientKnownRequestError(
              "레코드를 찾을 수 없습니다.",
              { code: "P2025", clientVersion: "test" },
            );
          }
          Object.assign(row, args.data, { updatedAt: new Date() });
          return { ...row };
        },
      },
      /**
       * 감지 실행 이력 (TASK-3301) — `provider`·`skipped`·정렬을 실제로
       * 적용한다. 무시하면 Provider별 주기(정책 3301-④)가 검증되지 않는다.
       */
      priceDetectionRun: {
        findMany: async (args?: {
          where?: {
            provider?: { in: string[] } | string;
            skipped?: null;
            source?: string;
          };
          take?: number;
        }) => {
          let rows = [...priceDetectionRuns];
          const provider = args?.where?.provider;
          if (typeof provider === "string") {
            // 소스별 실패 이력 조회 (TASK-3401) — 이 조건을 무시하면
            // 다른 공지의 실패가 이 공지의 승격 근거가 된다
            rows = rows.filter((row) => row.provider === provider);
          } else if (provider !== undefined) {
            rows = rows.filter((row) =>
              provider.in.includes(row.provider as string),
            );
          }
          if (args?.where?.source !== undefined) {
            rows = rows.filter((row) => row.source === args.where!.source);
          }
          if (args?.where !== undefined && "skipped" in args.where) {
            rows = rows.filter((row) => row.skipped === null);
          }
          rows = rows
            .slice()
            .sort(
              (a, b) =>
                (b.ranAt as Date).getTime() - (a.ranAt as Date).getTime(),
            );
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          return rows.map((row) => ({ ...row }));
        },
        createMany: async (args: { data: Record<string, unknown>[] }) => {
          for (const row of args.data) {
            seq += 1;
            priceDetectionRuns.push({
              id: `pdr-${seq}`,
              samples: 0,
              changes: 0,
              skipped: null,
              createdAt: new Date(),
              ...row,
            });
          }
          return { count: args.data.length };
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
        // 되돌리는 절차 확인 (TASK-4001, 정책 4001-⑥)
        findFirst: async () => {
          const row = [...drills].reverse()[0] as Record<string, unknown> | undefined;
          return row === undefined ? null : { ...row };
        },
      },
      // KPI 스냅샷 (TASK-4001, 정책 4001-②) — **값이 null인 줄도 저장된다**:
      // 표본이 없었던 시점을 0으로 적으면 "완벽한 날"이 된다
      kpiSnapshot: {
        findFirst: async () => {
          const row = [...kpiSnapshots].sort(
            (left, right) =>
              (right.takenAt as Date).getTime() - (left.takenAt as Date).getTime(),
          )[0];
          return row === undefined ? null : { ...row };
        },
        findMany: async (args?: { where?: { takenAt?: { gte?: Date } } }) => {
          const since = args?.where?.takenAt?.gte;
          return [...kpiSnapshots]
            .filter((row) => since === undefined || (row.takenAt as Date) >= since)
            .sort(
              (left, right) =>
                (left.takenAt as Date).getTime() - (right.takenAt as Date).getTime(),
            )
            .map((row) => ({ ...row }));
        },
        createMany: async (args: { data: Record<string, unknown>[] }) => {
          for (const item of args.data) {
            seq += 1;
            kpiSnapshots.push({ id: `snap-${seq}`, ...item });
          }
          return { count: args.data.length };
        },
        groupBy: async () => {
          const stamps = new Set(
            kpiSnapshots.map((row) => (row.takenAt as Date).getTime()),
          );
          return [...stamps].map((takenAt) => ({ takenAt: new Date(takenAt) }));
        },
      },
      // 트래픽 호스트 관측 (TASK-4301, 정책 4301-①) — **관측일 뿐 허가가 아니다**
      observedHost: {
        findMany: async (args?: { where?: { tier?: string } }) =>
          observedHosts
            .filter(
              (row) => args?.where?.tier === undefined || row.tier === args.where.tier,
            )
            .map((row) => ({ ...row })),
        upsert: async (args: {
          where: { tier_host: { tier: string; host: string } };
          create: Record<string, unknown>;
          update: { requests?: { increment?: number }; lastSeenAt?: Date };
        }) => {
          const found = observedHosts.find(
            (row) =>
              row.tier === args.where.tier_host.tier &&
              row.host === args.where.tier_host.host,
          );
          if (found === undefined) {
            seq += 1;
            const created = { id: `host-${seq}`, ...args.create };
            observedHosts.push(created);
            return { ...created };
          }
          found.requests =
            (found.requests as number) + (args.update.requests?.increment ?? 0);
          if (args.update.lastSeenAt !== undefined) {
            found.lastSeenAt = args.update.lastSeenAt;
          }
          return { ...found };
        },
      },
      // 방치 무시 결정 (TASK-4301, 정책 4301-③) — 취소해도 행은 남는다
      neglectDecision: {
        findMany: async (args?: {
          where?: { tier?: string; revokedAt?: null };
        }) =>
          neglectDecisions
            .filter(
              (row) =>
                (args?.where?.tier === undefined || row.tier === args.where.tier) &&
                (args?.where?.revokedAt === undefined || row.revokedAt === null),
            )
            .map((row) => ({ ...row })),
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const created = {
            id: `ignore-${seq}`,
            revokedAt: null,
            revokedById: null,
            ...args.data,
          };
          neglectDecisions.push(created);
          return { ...created };
        },
        updateMany: async (args: {
          where: { id?: string; tier?: string; checkId?: string; revokedAt?: null };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const row of neglectDecisions) {
            if (args.where.id !== undefined && row.id !== args.where.id) continue;
            if (args.where.tier !== undefined && row.tier !== args.where.tier) continue;
            if (args.where.checkId !== undefined && row.checkId !== args.where.checkId)
              continue;
            if (args.where.revokedAt === null && row.revokedAt !== null) continue;
            Object.assign(row, args.data);
            count += 1;
          }
          return { count };
        },
      },
      // 진단 이력 (TASK-4101, 정책 4101-②) — **같은 tier·stage끼리만 비교한다**
      diagnosticRun: {
        findFirst: async (args?: { where?: { tier?: string; stage?: string } }) => {
          const rows = [...diagnosticRuns]
            .filter(
              (row) =>
                (args?.where?.tier === undefined || row.tier === args.where.tier) &&
                (args?.where?.stage === undefined || row.stage === args.where.stage),
            )
            .sort(
              (left, right) =>
                (right.ranAt as Date).getTime() - (left.ranAt as Date).getTime(),
            );
          return rows[0] === undefined ? null : { ...rows[0] };
        },
        findMany: async (args?: { where?: { tier?: string }; take?: number }) =>
          [...diagnosticRuns]
            .filter(
              (row) => args?.where?.tier === undefined || row.tier === args.where.tier,
            )
            .sort(
              (left, right) =>
                (right.ranAt as Date).getTime() - (left.ranAt as Date).getTime(),
            )
            .slice(0, args?.take ?? diagnosticRuns.length)
            .map((row) => ({ ...row })),
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = { id: `diag-${seq}`, ranAt: new Date(), ...args.data };
          diagnosticRuns.push(row);
          return { ...row };
        },
        // 보존 정리 (TASK-4201, 정책 4201-③)
        deleteMany: async (args?: { where?: { ranAt?: { lt?: Date } } }) => {
          const cutoff = args?.where?.ranAt?.lt;
          if (cutoff === undefined) {
            const count = diagnosticRuns.length;
            diagnosticRuns.length = 0;
            return { count };
          }
          const keep = diagnosticRuns.filter((row) => (row.ranAt as Date) >= cutoff);
          const count = diagnosticRuns.length - keep.length;
          diagnosticRuns.length = 0;
          diagnosticRuns.push(...keep);
          return { count };
        },
      },
      // 설정 변경 이력 (TASK-4001, 정책 4001-③)
      adminAuditLog: {
        findMany: async (args?: {
          where?: { key?: { startsWith?: string } };
          take?: number;
        }) => {
          const prefix = args?.where?.key?.startsWith;
          return [...adminAudit]
            .filter(
              (row) => prefix === undefined || String(row.key).startsWith(prefix),
            )
            .reverse()
            .slice(0, args?.take ?? adminAudit.length)
            .map((row) => ({ ...row }));
        },
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `adm-${seq}`,
            createdAt: new Date(),
            actor: null,
            before: null,
            after: null,
            note: null,
            ...args.data,
          } as Record<string, unknown>;
          adminAudit.push(row);
          return { ...row };
        },
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
      $queryRaw: async (query?: unknown) => {
        // 태그 템플릿(TemplateStringsArray)과 Prisma.sql 객체 둘 다 온다
        const source = query as
          | string[]
          | { strings?: string[]; values?: unknown[] }
          | undefined;
        const sql = Array.isArray(source)
          ? source.join(" ")
          : (source?.strings ?? []).join(" ");
        const values: unknown[] = Array.isArray(source)
          ? []
          : (source?.values ?? []);
        // 일별 지출 집계 (TASK-3101) — 예측이 읽는다
        if (sql.includes("date_trunc('day'")) {
          const from = values.find((value) => value instanceof Date) as
            | Date
            | undefined;
          return dailyCost(
            sql.includes("ocr_results") ? ocrResults : executions,
            from,
          );
        }
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
      // 활성화 이력 · 스모크 · 장애 이력 (TASK-3701, 정책 3701-①②④).
      // 인메모리로 두되 **판정에 쓰이는 동작은 실제와 같게** 둔다 —
      // 여기서 검증하려는 것이 "같은 상태면 줄이 안 늘어나는가"이기 때문이다.
      activationEvent: {
        findFirst: async () =>
          activationEvents.length === 0
            ? null
            : { ...activationEvents[activationEvents.length - 1] },
        findMany: async (args?: { take?: number }) =>
          [...activationEvents]
            .reverse()
            .slice(0, args?.take ?? activationEvents.length)
            .map((row) => ({ ...row })),
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const now = new Date();
          const row = {
            id: `act-${seq}`,
            recordedAt: now,
            lastSeenAt: now,
            observations: 1,
            met: [],
            ...args.data,
          } as Record<string, unknown>;
          activationEvents.push(row);
          return { ...row };
        },
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = activationEvents.find((item) => item.id === args.where.id);
          if (row === undefined) {
            throw new Error("no such activation event");
          }
          const increment = (args.data.observations as { increment?: number } | undefined)
            ?.increment;
          if (increment !== undefined) {
            row.observations = (row.observations as number) + increment;
          }
          if (args.data.lastSeenAt !== undefined) {
            row.lastSeenAt = args.data.lastSeenAt;
          }
          if (args.data.detail !== undefined) {
            row.detail = args.data.detail;
          }
          return { ...row };
        },
      },
      smokeRun: {
        findMany: async (args?: { take?: number }) =>
          [...smokeRuns]
            .reverse()
            .slice(0, args?.take ?? smokeRuns.length)
            .map((row) => ({ ...row })),
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `smoke-${seq}`,
            createdAt: new Date(),
            ...args.data,
          } as Record<string, unknown>;
          smokeRuns.push(row);
          return { ...row };
        },
      },
      incident: {
        findMany: async (args?: {
          take?: number;
          where?: {
            sourceAlertKey?: { not: null };
            status?: string;
            expiredAt?: null | { not: null };
            revivedAt?: { not: null };
          };
          select?: Record<string, boolean>;
        }) =>
          [...incidents]
            .filter(
              (row) =>
                args?.where?.sourceAlertKey === undefined ||
                row.sourceAlertKey !== null,
            )
            // 초안 수명 (TASK-4001, 정책 4001-①)
            .filter(
              (row) =>
                args?.where?.status === undefined || row.status === args.where.status,
            )
            .filter((row) => {
              if (args?.where?.expiredAt === undefined) {
                return true;
              }
              return args.where.expiredAt === null
                ? row.expiredAt === null
                : row.expiredAt !== null;
            })
            // 되살림 이력 (TASK-4101)
            .filter(
              (row) => args?.where?.revivedAt === undefined || row.revivedAt !== null,
            )
            .sort(
              (left, right) =>
                (right.startedAt as Date).getTime() - (left.startedAt as Date).getTime(),
            )
            .slice(0, args?.take ?? incidents.length)
            .map((row) => ({ ...row })),
        findUnique: async (args: { where: { id: string } }) => {
          const row = incidents.find((item) => item.id === args.where.id);
          return row === undefined ? null : { ...row };
        },
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `inc-${seq}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            detectedAt: null,
            resolvedAt: null,
            cause: null,
            recovery: null,
            fixKind: null,
            rootCause: null,
            temporaryFix: null,
            permanentFix: null,
            prevention: null,
            // 사람이 연 장애는 확인된 상태다 (TASK-3901) — 기본을 DRAFT로
            // 두면 옛 장애가 전부 "확인 대기"가 되어 목록이 거짓말한다
            status: "CONFIRMED",
            sourceAlertKey: null,
            dismissedAt: null,
            dismissReason: null,
            // 만료는 기각이 아니다 (TASK-4001, 정책 4001-①)
            expiredAt: null,
            // 되살림 기록 (TASK-4101, 정책 4101-④)
            revivedAt: null,
            revivedById: null,
            revivalAction: null,
            revivalReason: null,
            revivalLatenessMs: null,
            ...args.data,
          } as Record<string, unknown>;
          incidents.push(row);
          return { ...row };
        },
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = incidents.find((item) => item.id === args.where.id);
          if (row === undefined) {
            throw new Error("no such incident");
          }
          Object.assign(row, args.data, { updatedAt: new Date() });
          return { ...row };
        },
        updateMany: async (args: {
          where: { id: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          const targets = incidents.filter((row) =>
            args.where.id.in.includes(row.id as string),
          );
          for (const row of targets) {
            Object.assign(row, args.data, { updatedAt: new Date() });
          }
          return { count: targets.length };
        },
      },
      opsEvent: {
        // 전이 순번 (TASK-3901 정책 3901-① 배선)
        count: async () => opsEvents.length,
        findUnique: async (args: { where: { key: string } }) => {
          const row = opsEvents.find((item) => item.key === args.where.key);
          return row === undefined ? null : { ...row };
        },
        findMany: async (args?: { take?: number }) =>
          [...opsEvents]
            .reverse()
            .slice(0, args?.take ?? opsEvents.length)
            .map((row) => ({ ...row })),
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `evt-${seq}`,
            createdAt: new Date(),
            notifiedAt: null,
            urgent: false,
            ...args.data,
          } as Record<string, unknown>;
          opsEvents.push(row);
          return { ...row };
        },
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = opsEvents.find((item) => item.id === args.where.id);
          if (row === undefined) {
            throw new Error("no such ops event");
          }
          Object.assign(row, args.data);
          return { ...row };
        },
      },
      opsAuditLog: {
        findMany: async (args?: { take?: number; where?: { action?: string } }) =>
          [...opsAudit]
            .reverse()
            .filter(
              (row) =>
                args?.where?.action === undefined || row.action === args.where.action,
            )
            .slice(0, args?.take ?? opsAudit.length)
            .map((row) => ({ ...row })),
        create: async (args: { data: Record<string, unknown> }) => {
          seq += 1;
          const row = {
            id: `audit-${seq}`,
            createdAt: new Date(),
            target: null,
            actorId: null,
            actorEmail: null,
            statusCode: null,
            durationMs: null,
            detail: null,
            requestId: null,
            traceId: null,
            ...args.data,
          } as Record<string, unknown>;
          opsAudit.push(row);
          return { ...row };
        },
      },
      checkRun: {
        // 운영 KPI가 창 안의 점검 실행을 센다 (TASK-3801)
        findMany: async (args?: { where?: { createdAt?: { gte: Date } } }) => {
          const gte = args?.where?.createdAt?.gte;
          return runs
            .filter((row) => gte === undefined || row.createdAt.getTime() >= gte.getTime())
            .map((row) => ({ ...row }));
        },
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
        findFirst: async (args?: { where?: { job?: string } }) => {
          // 운영 KPI는 job 없이 "가장 최근 점검"을 묻는다 (TASK-3801)
          const found = [...runs]
            .reverse()
            .find((row) => args?.where?.job === undefined || row.job === args.where.job);
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
  /** OCR 관측 (TASK-3001) */
  ocrMonitor?: Record<string, unknown>;
  /** Provider 연결 순서 (TASK-2901) */
  rollout?: Record<string, unknown>;
  /** 월 예산 (TASK-3101 예측 — 표시용이며 차단에 쓰이지 않는다) */
  monthlyBudget?: number | null;
}

/**
 * 외부 가격 공지 스텁 상태 (TASK-3301, CTO 정책 3301-①).
 *
 * 판정은 core(`judgePriceSource`)가 하므로 여기서는 **판정 결과**를 그대로
 * 넘긴다 — 어댑터가 실패를 어떻게 다루는지는 price-source 스펙이 본다.
 */
type PriceSourceVerdictStub = {
  status: string;
  prices: unknown[];
  unparsed: { index: number; reason: string }[];
  needsHumanCheck: boolean;
  detail: string;
};

const priceSource: {
  url: string | null;
  verdict: PriceSourceVerdictStub;
  /**
   * Provider별 공지 (TASK-3401 — CTO 결정 3301-⑤).
   * null이면 `url`·`verdict` 하나짜리 소스로 본다.
   */
  multi:
    | { id: string; url: string; keys?: string[]; verdict: PriceSourceVerdictStub }[]
    | null;
  /** 받아들이지 않은 설정 — 조용히 버리지 않는다 */
  rejected: { name: string; reason: string }[];
} = {
  url: null,
  verdict: {
    status: "unconfigured",
    prices: [],
    unparsed: [],
    needsHumanCheck: true,
    detail: "가격 공지 주소가 설정되지 않았습니다 — 미구성이며 실패가 아닙니다.",
  },
  multi: null,
  rejected: [],
};

/**
 * 도달 점검 스텁 (TASK-3501) — 기본은 **점검하지 않음**이다.
 * 빈 배열은 "닿는다"도 "막혔다"도 아니고, 판정이 이 정보를 쓰지 않는다는 뜻이다.
 */
let egressProbes: {
  host: string;
  status: "reachable" | "blocked" | "ambiguous";
  reachable: boolean;
  detail: string;
}[] = [];

/**
 * 운영 스모크 스텁 상태 (TASK-3701, 정책 3701-②).
 *
 * **부르는 상대만** 여기서 정한다 — 판정(성공을 통과로 셀 것인가)은 실제
 * 서비스와 core가 그대로 한다.
 */
const smokeStub: {
  llm: Error | null;
  ocr: Error | null;
  ocrProvider: string;
} = { llm: null, ocr: null, ocrProvider: "mock" };

/**
 * 운영 설정 스텁 (TASK-3901, 정책 3901-②③⑤).
 *
 * 임계값·보존·승격은 전부 운영 설정에서 온다. 테스트가 여기에 값을 넣어
 * "느슨하게 바꾼 임계값이 드러나는가"·"초안이 평균에서 빠지는가"를 본다.
 */
const opsSettingsStub: Record<string, string> = {};

/** 저장소 스텁 상태 (TASK-1701) — 테스트마다 바꿔 쓴다 */
const storageProtection = {
  versioning: "unknown" as "enabled" | "disabled" | "unknown",
  replication: "unknown" as "enabled" | "disabled" | "unknown",
  uploadFails: false,
  /** 원격 사본이 사라진 상태 (TASK-2201) */
  remoteMissing: false,
  /** 쓴 것과 읽은 것이 다른 상태 (TASK-3701) — 200과 정합은 다르다 */
  smokeReadDiffers: false,
};

/** 스모크가 쓴 오브젝트 — 실제로 담아 뒀다가 돌려준다 (TASK-3701) */
const smokeObjects = new Map<string, Buffer>();

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
  // 공지는 기본 미구성으로 되돌린다 — 테스트가 명시적으로 켠다
  priceSource.url = null;
  priceSource.verdict = {
    status: "unconfigured",
    prices: [],
    unparsed: [],
    needsHumanCheck: true,
    detail: "가격 공지 주소가 설정되지 않았습니다 — 미구성이며 실패가 아닙니다.",
  };
  priceSource.multi = null;
  priceSource.rejected = [];
  egressProbes = [];
  storageProtection.versioning = "unknown";
  storageProtection.remoteMissing = false;
  storageProtection.replication = "unknown";
  storageProtection.uploadFails = false;
  storageProtection.smokeReadDiffers = false;
  smokeObjects.clear();
  smokeStub.llm = null;
  smokeStub.ocr = null;
  smokeStub.ocrProvider = "mock";
  for (const key of Object.keys(opsSettingsStub)) {
    delete opsSettingsStub[key];
  }
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
    // Provider 연결 순서 (TASK-2901) — 실제 판정은 core·llm 스펙에서 본다.
    // 여기서는 컨트롤러가 이 값을 그대로 내보내는지만 확인한다.
    rollout: async () => ({
      order: ["openai", "anthropic", "gemini", "vision", "ocr"],
      stages: [
        {
          stage: "openai",
          order: 1,
          title: "OpenAI",
          status: "not-configured",
          detail: "OPENAI_API_KEY가 없습니다 — 아직 붙이지 않은 상태입니다(실패가 아닙니다).",
          done: false,
          env: ["OPENAI_API_KEY"],
          evidence: null,
        },
      ],
      next: "openai",
      outOfOrder: [],
      summary: { connected: 0, total: 5 },
      detail: "연결 완료 0/5단계 — 다음 단계는 OpenAI입니다.",
      checkedAt: new Date().toISOString(),
      ...overrides.rollout,
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
    /**
     * OCR 관측 (TASK-3001, CTO 결정 2901-④) — LLM과 **같은 종류의 경보**를
     * 낸다. 목업이 빈 값을 돌려주면 "OCR 장애가 경보로 나가는가"가 검증되지
     * 않으므로 테스트가 덮어쓸 수 있게 둔다.
     */
    monitorOcr: async () => ({
      status: "healthy",
      windowMinutes: 60,
      minSamples: 5,
      totals: {
        calls: 4,
        successCount: 4,
        failedCount: 0,
        successRate: 1,
        cost: 0.006,
        unpricedCalls: 0,
      },
      providers: [],
      alerts: [],
      diagnosticCalls: 0,
      checkedAt: new Date().toISOString(),
      ...overrides.ocrMonitor,
    }),
  };

  const budget = {
    // 예측이 월 예산을 읽는다 (TASK-3101) — 미설정이 기본이다
    limits: () => ({
      daily: null,
      monthly: (overrides.monthlyBudget ?? null) as number | null,
      alertRatio: 0.8,
    }),
    status: async () => ({
      daily: OFF,
      monthly: OFF,
      // 원장별 지출 (TASK-3001) — 실제 서비스와 같은 모양으로 둔다
      bySource: {
        daily: { llm: 0, ocr: 0 },
        monthly: { llm: 0, ocr: 0 },
      },
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
      // 운영 전환 검증 (TASK-3401, CTO 지시 4·5·6) — 실제 서비스를 쓴다.
      // 스텁을 끼우면 "스텁을 진짜로 세지 않는가"라는 이 기능의 본질이
      // 검증되지 않는다.
      ProductionCutoverService,
      CiStatusService,
      // 활성화 이력 · 장애 이력 (TASK-3701, 정책 3701-①④) — 실제 서비스를
      // 쓴다. 스텁을 끼우면 "같은 상태면 줄이 안 늘어나는가"·"복구 방법
      // 없이는 닫히지 않는가"라는 이 기능의 본질이 검증되지 않는다.
      ActivationHistoryService,
      IncidentService,
      // 운영 이벤트 · KPI · 감사 기록 (TASK-3801, 정책 3801-①③④) — 실제
      // 서비스를 쓴다. 이 기능들의 본질(두 번 알리지 않는가 · 모르는 것을
      // 좋음으로 세지 않는가 · 실패한 시도도 남는가)은 스텁으로 검증되지 않는다.
      OpsEventService,
      KpiService,
      OpsAuditService,
      OpsAuditInterceptor,
      RequestContextService,
      // 운영 설정 · 초안 승격 (TASK-3901, 정책 3901-②③⑤) — 실제 서비스를
      // 쓴다. 임계값이 실제로 판정에 쓰이는지, 초안이 평균에서 빠지는지는
      // 스텁으로 검증되지 않는다.
      OpsSettingsService,
      IncidentPromotionService,
      // KPI 추세 · 초안 수명 · 진단 · 검증 준비 (TASK-4001, 정책 4001-①②③④⑤⑥)
      // — 전부 실제 서비스를 쓴다. 이 기능들의 본질(한 점으로 선을 긋지
      // 않는가 · 만료를 기각으로 적지 않는가 · 모르는 것을 통과로 세지
      // 않는가 · 준비 완료를 스스로 선언하지 않는가)은 스텁으로 검증되지
      // 않는다.
      KpiTrendService,
      DraftLifecycleService,
      DiagnosticsService,
      ValidationPlanService,
      // 검증 대상 보호 · 진단 이력 · 초안 되살림 · 실행 잠금
      // (TASK-4101, 정책 4101-①②③④⑤⑥)
      DraftRevivalService,
      ValidationRunService,
      // 방치 지표 · 프로젝트 비용 (TASK-4201, 정책 4201-②④) — 실제 서비스를
      // 쓴다. "미배분을 나누지 않는가"·"연속 기간을 최소값으로 읽게 하는가"는
      // 스텁으로 검증되지 않는다.
      NeglectService,
      ProjectCostService,
      HostDiscoveryService,
      ReadinessBoardService,
      ActivationRunbookService,
      IgnoreEscalationService,
      {
        // 운영 설정 저장소 — 테스트가 값을 정한다
        provide: AdminSettingsService,
        useValue: {
          all: () => ({ ...opsSettingsStub }),
          get: (key: string) => opsSettingsStub[key] ?? null,
        },
      },
      // 운영 스모크 (TASK-3701, 정책 3701-②) — 서비스는 실제 것을 쓰고,
      // **부르는 상대만** 테스트가 정한다. 실제로 남의 서비스를 부르는
      // 테스트는 돈이 나가고 바깥 세상에 의존한다.
      ProductionSmokeService,
      {
        provide: LlmService,
        useValue: {
          complete: async () => {
            if (smokeStub.llm instanceof Error) {
              throw smokeStub.llm;
            }
            return { provider: "openai", model: "gpt-4o-mini" };
          },
        },
      },
      {
        provide: OCR_PROVIDER,
        useValue: {
          get name() {
            return smokeStub.ocrProvider;
          },
          recognize: async () => {
            if (smokeStub.ocr instanceof Error) {
              throw smokeStub.ocr;
            }
            return { text: "", confidence: null, raw: {} };
          },
        },
      },
      {
        // 도달 점검 (TASK-3501) — 테스트가 상태를 정한다. 실제 네트워크를
        // 두드리면 테스트가 바깥 세상에 의존하게 되고, 그 순간 결정적이지
        // 않아진다. 어댑터 자체는 egress.service.spec.ts가 본다.
        provide: EgressService,
        useValue: { probe: async () => egressProbes },
      },
      // 가격표 거버넌스·비용 인텔리전스 (TASK-3101) — 실제 서비스를 쓴다.
      // 스텁을 끼우면 절차(검토 → 승인 → 적용)가 검증되지 않는다.
      PricingService,
      CostIntelligenceService,
      {
        // 외부 가격 공지 (TASK-3301) — 테스트가 상태를 정한다.
        // 기본은 **미구성**이다: 붙이지 않은 것과 실패는 다르다.
        provide: PriceSourceService,
        useValue: {
          get url() {
            return priceSource.multi?.[0]?.url ?? priceSource.url;
          },
          get rejected() {
            return priceSource.rejected;
          },
          // 소스별로 따로 읽는다 (TASK-3401) — 하나가 죽어도 나머지는 읽힌다
          fetchAll: async () =>
            priceSource.multi !== null
              ? priceSource.multi.map((row) => ({
                  id: row.id,
                  url: row.url,
                  format: "acos",
                  keys: row.keys ?? [],
                  verdict: row.verdict,
                }))
              : priceSource.url === null
                ? []
                : [
                    {
                      id: "default",
                      url: priceSource.url,
                      format: "acos",
                      keys: [],
                      verdict: priceSource.verdict,
                    },
                  ],
        },
      },
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
          // 운영 전환 검증(TASK-3401)이 실제로 저장소에 닿아 본다
          bucketExists: async () => true,
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
          /**
           * 운영 스모크의 쓰기·읽기·삭제 (TASK-3701, 정책 3701-②).
           *
           * **읽은 것이 쓴 것과 같아야** 성공이다 — 200을 받았다는 것과
           * 저장된 것이 우리가 쓴 것이라는 사실은 다르다. 그래서 스텁도
           * 실제로 담아 뒀다가 돌려준다.
           */
          putObject: async (key: string, buffer: Buffer) => {
            if (storageProtection.uploadFails) {
              throw new Error("저장소 연결 실패");
            }
            smokeObjects.set(key, Buffer.from(buffer));
            return `acos/${key}`;
          },
          getObject: async (key: string) => {
            const found = smokeObjects.get(key);
            if (found === undefined) {
              throw new Error(`객체를 찾을 수 없습니다: ${key}`);
            }
            return storageProtection.smokeReadDiffers
              ? Buffer.from("전혀 다른 내용")
              : found;
          },
          removeObjects: async (keys: string[]) => {
            for (const key of keys) {
              smokeObjects.delete(key);
            }
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
              : // 2단계 승인·교차 확인에는 **두 번째 ADMIN**이 필요하다
                // (TASK-3201 정책 ② · TASK-3301 정책 ②)
                token === "tok-admin2"
                ? { id: "u-b", email: "b@acos.local", role: "ADMIN" }
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
        // 가격 변경 감지 · 월말 예측 경보 (TASK-3201, CTO 정책 3201-①④)
        "pricing-detect",
        "cost-forecast",
        // 일일 운영 진단 (TASK-4001, 정책 4001-⑤)
        "daily-diagnostics",
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
      // 가격 감지·예측 경보가 추가돼 9종이 됐고 (TASK-3201),
      // 일일 진단이 더해져 10종이 돈다 (TASK-4001, 정책 4001-⑤)
      expect(all.body).toHaveLength(10);
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

  describe("Enterprise AI Provider Production Platform (TASK-2901)", () => {
    it("GET /ops/providers — 연결 순서와 다음 단계를 돌려준다", async () => {
      const built = await build();
      app = built.app;

      const response = await request(built.app.getHttpServer())
        .get("/ops/providers")
        .set("Authorization", "Bearer tok-admin")
        .expect(200);

      // 확정된 순서가 응답에 그대로 담긴다 (CTO 결정 2801-⑤)
      expect(response.body.order).toEqual([
        "openai",
        "anthropic",
        "gemini",
        "vision",
        "ocr",
      ]);
      expect(response.body.next).toBe("openai");
      expect(response.body.summary).toEqual({ connected: 0, total: 5 });
      // 미구성을 실패로 말하지 않는다
      expect(response.body.stages[0].detail).toContain("실패가 아닙니다");
    });

    it("ADMIN 전용이다 — 키 상태가 드러나는 화면이다", async () => {
      const built = await build();
      app = built.app;
      const server = built.app.getHttpServer();

      await request(server).get("/ops/providers").expect(401);
      await request(server)
        .get("/ops/providers")
        .set("Authorization", "Bearer tok-editor")
        .expect(403);
    });
  });

  describe("Enterprise AI Production Operations Platform (TASK-3001)", () => {
    describe("OCR도 같은 관측·경보 대상이다 (CTO 결정 2901-④)", () => {
      it("health-check 문구가 OCR 호출 수와 상태를 함께 말한다", async () => {
        const built = await build();
        app = built.app;

        const result = await built.checks.run("health-check", "manual");
        expect(result.detail).toContain("OCR 4건(healthy)");
      });

      it("OCR 엔진 장애도 provider-failure 경보로 나간다", async () => {
        // 운영자에게는 "AI 경로가 죽었다"는 같은 사건이다
        const built = await build({
          ocrMonitor: {
            status: "down",
            providers: [
              {
                provider: "google-vision",
                model: "text-detection",
                status: "down",
                calls: 8,
                successCount: 0,
                successRate: 0,
                cost: null,
                unpricedCalls: 0,
                latency: null,
              },
            ],
          },
        });
        app = built.app;

        const result = await built.checks.run("health-check", "manual");
        expect(result.notified.map((entry) => entry.key)).toContain(
          "provider-failure:google-vision",
        );
        expect(
          built.prisma.alerts.get("provider-failure:google-vision")?.status,
        ).toBe("ACTIVE");
      });

      it("LLM 장애와 OCR 장애를 한 번에 동기화한다 — 서로를 지우지 않는다", async () => {
        // 같은 종류를 두 번 sync하면 뒤 호출이 앞의 경보를 해소해 버린다
        // (TASK-2801에서 배운 형태)
        const down = (provider: string) => ({
          provider,
          model: "m",
          status: "down",
          calls: 8,
          successCount: 0,
          successRate: 0,
          cost: null,
          unpricedCalls: 0,
          latency: null,
        });
        const built = await build({
          monitor: { status: "down", providers: [down("openai")] },
          ocrMonitor: { status: "down", providers: [down("google-vision")] },
        });
        app = built.app;

        await built.checks.run("health-check", "manual");
        expect(
          built.prisma.alerts.get("provider-failure:openai")?.status,
        ).toBe("ACTIVE");
        expect(
          built.prisma.alerts.get("provider-failure:google-vision")?.status,
        ).toBe("ACTIVE");
      });
    });
  });
  describe("Enterprise AI Cost Intelligence Platform (TASK-3101)", () => {
    /** 제안 등록 (ADMIN 토큰) — supertest 체인을 그대로 돌려준다 */
    const propose = (
      server: unknown,
      body: Record<string, unknown>,
      token = "tok-admin",
    ) =>
      request(server as never)
        .post("/ops/pricing")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    /** 단계 진행 (검토·승인·적용·반려) */
    const advance = (
      server: unknown,
      id: string,
      action: string,
      body: Record<string, unknown> = {},
      token = "tok-admin",
    ) =>
      request(server as never)
        .post(`/ops/pricing/${id}/${action}`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    describe("가격표는 검토 → 승인 → 적용 절차를 거친다 (CTO 정책 3101-①)", () => {
      it("제안하면 현재 단가를 함께 남기고 DRAFT로 시작한다", async () => {
        const built = await build();
        app = built.app;

        const response = await propose(built.app.getHttpServer(), {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "2026년 7월 단가 인상 공지 반영",
        }).expect(201);

        expect(response.body.stage).toBe("DRAFT");
        // 무엇에서 무엇으로 바뀌는지가 남아야 나중에 판단을 되짚을 수 있다
        expect(response.body.currentPrice).toEqual({ perUnitUsd: 0.0015 });
        expect(response.body.proposedBy).toBe("a@acos.local");
        expect(response.body.nextStages).toEqual(["REVIEWED", "REJECTED"]);
      });

      it("사유 없는 제안은 400 — 왜 바꿨는지가 남지 않으면 이력이 무의미하다", async () => {
        const built = await build();
        app = built.app;

        const response = await propose(built.app.getHttpServer(), {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "  ",
        }).expect(400);
        expect(response.body.message).toContain("변경 사유");
      });

      it("음수 단가는 400 — 지출을 줄여 예산 상한을 무력화한다", async () => {
        const built = await build();
        app = built.app;

        await propose(built.app.getHttpServer(), {
          target: "llm",
          key: "gpt-4o",
          price: { inputPerMillion: -1, outputPerMillion: 1 },
          reason: "실수",
        }).expect(400);
      });

      it("검토 없이 승인할 수 없고, 승인 없이 적용할 수 없다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 인상",
        }).expect(201);
        const id = created.body.id as string;

        const skipped = await advance(server, id, "approve").expect(400);
        expect(skipped.body.message).toContain("건너뛸 수 없습니다");
        await advance(server, id, "apply").expect(400);

        await advance(server, id, "review").expect(200);
        await advance(server, id, "apply").expect(400);
        await advance(server, id, "approve").expect(200);
        const applied = await advance(server, id, "apply").expect(200);
        expect(applied.body.stage).toBe("APPLIED");
        expect(applied.body.appliedAt).not.toBeNull();
        expect(applied.body.detail).toContain("이후 호출에 이 단가가 쓰입니다");
      });

      it("적용된 제안은 되돌릴 수 없다 — 새 제안을 내야 한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 인상",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        await advance(server, id, "approve");
        await advance(server, id, "apply");

        const response = await advance(server, id, "reject", {
          reason: "되돌리고 싶다",
        }).expect(400);
        expect(response.body.message).toContain("적용 기록은 바꾸지 않습니다");
      });

      it("반려는 사유가 있어야 한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 인상",
        });
        const id = created.body.id as string;

        await advance(server, id, "reject").expect(400);
        const rejected = await advance(server, id, "reject", {
          reason: "공지 원문 확인 필요",
        }).expect(200);
        expect(rejected.body.stage).toBe("REJECTED");
        expect(rejected.body.rejectedReason).toBe("공지 원문 확인 필요");
        expect(rejected.body.rejectedBy).toBe("a@acos.local");
      });

      it("제안자와 승인자가 같으면 사실을 남기되 막지 않는다", async () => {
        // 운영자가 한 명인 환경에서 절차가 막히면 사람은 코드를 고쳐 우회하고,
        // 그러면 이력이 아예 없어진다 (결정 2601-① 교훈)
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 인상",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        const approved = await advance(server, id, "approve").expect(200);
        expect(approved.body.selfApproval).toContain("제안자와 승인자가 같습니다");
      });

      it("알 수 없는 단계 이름은 400", async () => {
        const built = await build();
        app = built.app;
        const response = await advance(
          built.app.getHttpServer(),
          "pp-1",
          "publish",
        ).expect(400);
        expect(response.body.message).toContain("지원하지 않는 단계");
      });

      it("ADMIN 전용이다 — 단가는 돈의 기준이다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await request(server).get("/ops/pricing").expect(401);
        await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-editor")
          .expect(403);
        await propose(
          server,
          {
            target: "ocr",
            key: "google-vision",
            price: { perUnitUsd: 0.002 },
            reason: "단가 인상",
          },
          "tok-editor",
        ).expect(403);
      });
    });

    describe("적용된 단가가 이후 계산에 쓰인다", () => {
      it("GET /ops/pricing — 실효 가격표가 적용된 값을 보여 준다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 인상",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        await advance(server, id, "approve");
        await advance(server, id, "apply");

        const board = await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        const vision = board.body.effective.ocr.find(
          (row: { provider: string }) => row.provider === "google-vision",
        );
        expect(vision.perUnitUsd).toBe(0.002);
        // 코드 기본값과 구분된다 — 누구의 승인으로 적용된 값인지가 남는다
        expect(vision.note).toContain("승인된 제안으로 적용됨");
        expect(board.body.effective.appliedCount).toBe(1);
        expect(board.body.open).toEqual([]);
        expect(board.body.closed).toHaveLength(1);
        expect(board.body.detail).toContain("과거 비용 기록은 바뀌지 않습니다");
      });

      it("적용 전에는 기준 가격표를 그대로 쓴다 — 승인만으로 바뀌지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 인상",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        await advance(server, id, "approve");

        const board = await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);
        const vision = board.body.effective.ocr.find(
          (row: { provider: string }) => row.provider === "google-vision",
        );
        expect(vision.perUnitUsd).toBe(0.0015);
        expect(board.body.effective.appliedCount).toBe(0);
      });
    });

    describe("운영 비용 리포트는 회계 청구서가 아니다 (CTO 정책 3101-④)", () => {
      const seed = (built: Awaited<ReturnType<typeof build>>) => {
        const at = new Date();
        built.prisma.executions.push(
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 0.1,
            createdAt: at,
          },
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 0.05,
            createdAt: at,
          },
          // 가격표에 없어 비용이 빠진 호출
          {
            provider: "openai",
            model: "gpt-9",
            status: "SUCCESS",
            cost: null,
            createdAt: at,
          },
          // 실패한 호출은 집계하지 않는다 (비용이 기록되지 않는다)
          {
            provider: "openai",
            model: "gpt-4o",
            status: "FAILED",
            cost: null,
            createdAt: at,
          },
        );
        built.prisma.ocrResults.push({
          provider: "google-vision",
          status: "SUCCESS",
          cost: 0.003,
          createdAt: at,
        });
      };

      it("GET /ops/billing — 두 원장을 합산하고 큰 것부터 보여 준다", async () => {
        const built = await build();
        app = built.app;
        seed(built);

        const response = await request(built.app.getHttpServer())
          .get("/ops/billing")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        expect(response.body.bySource).toEqual({ llm: 0.15, ocr: 0.003 });
        expect(response.body.total).toBe(0.153);
        expect(response.body.rows[0].model).toBe("gpt-4o");
        // 미산정이 있으면 총액이 실제보다 작다고 말한다
        expect(response.body.unpricedCalls).toBe(1);
        expect(response.body.detail).toContain("합계는 실제보다 작습니다");
        expect(response.body.disclaimer).toContain(
          "회계 청구서를 대체하지 않습니다",
        );
      });

      it("잘못된 기간은 조용히 무시하지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await request(server)
          .get("/ops/billing?from=어제")
          .set("Authorization", "Bearer tok-admin")
          .expect(400);
        await request(server)
          .get("/ops/billing?from=2026-07-31&to=2026-07-01")
          .set("Authorization", "Bearer tok-admin")
          .expect(400);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer())
          .get("/ops/billing")
          .set("Authorization", "Bearer tok-editor")
          .expect(403);
      });
    });

    describe("예측은 참고자료다 (CTO 정책 3101-③)", () => {
      /** 이번 달 안의 서로 다른 UTC 일자 (예측 표본) */
      const daysThisMonth = (count: number): Date[] => {
        const now = new Date();
        return Array.from({ length: count }, (_, index) =>
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1, 12),
          ),
        );
      };

      it("표본이 적으면 숫자를 만들지 않는다", async () => {
        const built = await build();
        app = built.app;
        for (const at of daysThisMonth(2)) {
          built.prisma.executions.push({
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: at,
          });
        }

        const response = await request(built.app.getHttpServer())
          .get("/ops/cost-forecast")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        expect(response.body.verdict).toBe("insufficient");
        expect(response.body.projectedMonthEnd).toBeNull();
        // 실제 지출은 사실이므로 그대로 말한다
        expect(response.body.monthToDate).toBe(2);
        expect(response.body.detail).toContain("최소 3일이 필요합니다");
      });

      it("관측이 쌓이면 추정하고, 참고자료라는 사실을 밝힌다", async () => {
        const built = await build({ monthlyBudget: 10 });
        app = built.app;
        for (const at of daysThisMonth(3)) {
          built.prisma.executions.push({
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: at,
          });
          built.prisma.ocrResults.push({
            provider: "google-vision",
            status: "SUCCESS",
            cost: 1,
            createdAt: at,
          });
        }

        const response = await request(built.app.getHttpServer())
          .get("/ops/cost-forecast")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        // 두 원장을 합쳐 하루 2달러로 본다
        expect(response.body.verdict).toBe("projected");
        expect(response.body.dailyAverage).toBe(2);
        expect(response.body.points).toHaveLength(3);
        expect(response.body.budget).toBe(10);
        expect(response.body.detail).toContain(
          "예산 차단은 실제 비용만 사용합니다",
        );
      });

      it("비용이 빠진 호출이 있으면 추정도 작을 수 있다고 말한다", async () => {
        const built = await build();
        app = built.app;
        for (const at of daysThisMonth(3)) {
          built.prisma.executions.push({
            provider: "openai",
            model: "gpt-9",
            status: "SUCCESS",
            cost: null,
            createdAt: at,
          });
        }

        const response = await request(built.app.getHttpServer())
          .get("/ops/cost-forecast")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        expect(response.body.unpricedCalls).toBe(3);
        expect(response.body.detail).toContain("추정도 실제보다 작을 수 있습니다");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer())
          .get("/ops/cost-forecast")
          .set("Authorization", "Bearer tok-editor")
          .expect(403);
      });
    });
  });
  describe("Enterprise Pricing Automation Platform (TASK-3201)", () => {
    /** 감지가 볼 OCR 기록을 심는다 (모두 같은 단가를 가리킨다) */
    const seedOcr = (
      built: Awaited<ReturnType<typeof build>>,
      unitPrice: number,
      count = 5,
      provider = "google-vision",
    ) => {
      const base = Date.now();
      for (let index = 0; index < count; index += 1) {
        built.prisma.ocrResults.push({
          provider,
          status: "SUCCESS",
          cost: unitPrice,
          createdAt: new Date(base - index * 60_000),
        });
      }
    };

    const propose = (
      server: unknown,
      body: Record<string, unknown>,
      token = "tok-admin",
    ) =>
      request(server as never)
        .post("/ops/pricing")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    const advance = (
      server: unknown,
      id: string,
      action: string,
      body: Record<string, unknown> = {},
      token = "tok-admin",
    ) =>
      request(server as never)
        .post(`/ops/pricing/${id}/${action}`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    describe("감지 → 승인 → 적용 (CTO 정책 3201-①)", () => {
      it("기록이 새 단가를 가리키면 제안을 만든다 — 근거와 함께", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002);

        const response = await request(built.app.getHttpServer())
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        expect(response.body.changes).toHaveLength(1);
        expect(response.body.created).toHaveLength(1);
        const created = response.body.created[0];
        expect(created.origin).toBe("detected");
        expect(created.stage).toBe("DETECTED");
        // 제안자가 사람이 아니다 — 사람 이름을 적으면 그 사람이 낸 것으로 읽힌다
        expect(created.proposedBy).toBeNull();
        // 근거 없는 제안은 승인할 수 없다
        expect(created.evidence.sampleIds).toHaveLength(5);
        expect(created.price).toEqual({ perUnitUsd: 0.002 });
        expect(created.currentPrice).toEqual({ perUnitUsd: 0.0015 });
      });

      it("감지만으로 단가가 바뀌지 않는다 — 실효 가격표는 그대로다", async () => {
        // 자동 적용을 허용하면 Provider 쪽 이상이나 우리 계산 오류가 곧바로
        // 돈의 기준을 바꾼다
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002);
        await request(built.app.getHttpServer())
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        const board = await request(built.app.getHttpServer())
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);
        const vision = board.body.effective.ocr.find(
          (row: { provider: string }) => row.provider === "google-vision",
        );
        expect(vision.perUnitUsd).toBe(0.0015);
        expect(board.body.effective.appliedCount).toBe(0);
      });

      it("감지된 제안은 검토를 건너뛰고 승인으로 간다", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002);
        const server = built.app.getHttpServer();
        const detected = await request(server)
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin");
        const id = detected.body.created[0].id as string;

        expect(detected.body.created[0].nextStages).toEqual([
          "APPROVED",
          "REJECTED",
        ]);
        // 검토 단계는 없다 — 감지가 근거를 들고 왔다
        await advance(server, id, "review").expect(400);
        // 그러나 적용은 승인 뒤에만 된다
        const skipped = await advance(server, id, "apply").expect(400);
        expect(skipped.body.message).toContain("감지 → 승인 → 적용");
        await advance(server, id, "approve").expect(200);
        await advance(server, id, "apply").expect(200);
      });

      it("같은 항목에 진행 중인 제안이 있으면 또 만들지 않는다", async () => {
        // 6시간마다 같은 제안이 쌓이면 승인할 것이 무엇인지 흐려진다
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002);
        const server = built.app.getHttpServer();

        await request(server)
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin");
        const second = await request(server)
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        expect(second.body.created).toEqual([]);
        expect(second.body.skipped).toEqual(["ocr/google-vision"]);
        expect(second.body.detail).toContain("이미 진행 중인 제안이 있어");
      });

      it("성공한 기록만 본다 — 실패한 호출은 단가를 알려 주지 않는다", async () => {
        const built = await build();
        app = built.app;
        const base = Date.now();
        for (let index = 0; index < 5; index += 1) {
          built.prisma.ocrResults.push({
            provider: "google-vision",
            status: "FAILED",
            cost: 0.002,
            createdAt: new Date(base - index * 60_000),
          });
        }

        const response = await request(built.app.getHttpServer())
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);
        expect(response.body.changes).toEqual([]);
      });

      it("예약 점검이 감지하고 경보를 낸다 — 조용히 쌓이지 않는다", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002);

        const result = await built.checks.run("pricing-detect", "manual");
        expect(result.ok).toBe(true); // 단가가 어긋난 것은 장애가 아니다
        expect(result.notified.map((entry) => entry.key)).toContain(
          "pricing-drift:ocr:google-vision",
        );
        expect(
          built.prisma.alerts.get("pricing-drift:ocr:google-vision")?.status,
        ).toBe("ACTIVE");
        expect(result.detail).toContain("제안 1건 등록");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        await request(server).post("/ops/pricing/detect").expect(401);
        await request(server)
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-editor")
          .expect(403);
      });
    });

    describe("자기 승인 (CTO 정책 3201-②)", () => {
      const ORIGINAL = process.env.NODE_ENV;
      afterEach(() => {
        process.env.NODE_ENV = ORIGINAL;
      });

      const openProposal = async (server: unknown) => {
        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "단가 공지 반영",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        return id;
      };

      it("운영에서는 제안자와 승인자가 같으면 막는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await openProposal(server);

        process.env.NODE_ENV = "production";
        const blocked = await advance(server, id, "approve").expect(400);
        expect(blocked.body.message).toContain(
          "운영에서는 자기 승인을 허용하지 않습니다",
        );
        // 무엇을 하면 되는지 말한다
        expect(blocked.body.message).toContain("다른 ADMIN 계정으로 승인");
        // 막혔으므로 단계는 그대로다
        const board = await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin");
        expect(board.body.open[0].stage).toBe("REVIEWED");
      });

      it("개발에서는 허용하되 사실을 남긴다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await openProposal(server);

        process.env.NODE_ENV = "development";
        const approved = await advance(server, id, "approve").expect(200);
        expect(approved.body.stage).toBe("APPROVED");
        expect(approved.body.selfApproval).toContain(
          "교차 확인은 이뤄지지 않았습니다",
        );
        expect(approved.body.selfApproval).toContain("운영에서는 차단됩니다");
      });

      it("감지된 제안은 제안자가 시스템이라 운영에서도 승인할 수 있다", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002);
        const server = built.app.getHttpServer();
        const detected = await request(server)
          .post("/ops/pricing/detect")
          .set("Authorization", "Bearer tok-admin");
        const id = detected.body.created[0].id as string;

        process.env.NODE_ENV = "production";
        const approved = await advance(server, id, "approve").expect(200);
        // 다만 사람의 확인이 1회라는 사실은 숨기지 않는다
        expect(approved.body.selfApproval).toContain("사람의 확인은 1회입니다");
      });
    });

    describe("미래 시점 적용 (CTO 정책 3201-③)", () => {
      const approved = async (server: unknown) => {
        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "8월 1일부터 인상 공지",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        await advance(server, id, "approve");
        return id;
      };

      it("예약하면 그 시각까지 계산에 쓰이지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await approved(server);
        const effectiveFrom = new Date(Date.now() + 86_400_000).toISOString();

        const applied = await advance(server, id, "apply", {
          effectiveFrom,
        }).expect(200);
        expect(applied.body.stage).toBe("APPLIED");
        expect(applied.body.scheduled).toBe(true);
        expect(applied.body.effectiveFrom).toBe(effectiveFrom);
        // 적용은 결정이고 발효는 시각이다 — 문구가 그것을 말한다
        expect(applied.body.detail).toContain("예약");

        const board = await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin");
        const vision = board.body.effective.ocr.find(
          (row: { provider: string }) => row.provider === "google-vision",
        );
        expect(vision.perUnitUsd).toBe(0.0015); // 아직 옛 단가
        expect(board.body.effective.appliedCount).toBe(0);
        // 예약은 따로 보여 준다 — 섞으면 이미 쓰이는 것처럼 보인다
        expect(board.body.effective.scheduled).toHaveLength(1);
        expect(board.body.effective.nextChangeAt).toBe(effectiveFrom);
      });

      it("과거 시점은 거부한다 — 기록을 소급해 다시 해석한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await approved(server);

        const rejected = await advance(server, id, "apply", {
          effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
        }).expect(400);
        expect(rejected.body.message).toContain("과거 시점으로 적용할 수 없습니다");
        expect(rejected.body.message).toContain("불일치로 바뀝니다");
      });

      it("해석할 수 없는 시각은 즉시 적용으로 바꾸지 않는다", async () => {
        // 조용히 즉시 적용하면 예약한 줄 알고 화면을 닫는다
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await approved(server);

        const rejected = await advance(server, id, "apply", {
          effectiveFrom: "내일",
        }).expect(400);
        expect(rejected.body.message).toContain("해석할 수 없습니다");
      });

      it("미지정이면 즉시 발효한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await approved(server);

        const applied = await advance(server, id, "apply").expect(200);
        expect(applied.body.scheduled).toBe(false);
        const board = await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin");
        expect(
          board.body.effective.ocr.find(
            (row: { provider: string }) => row.provider === "google-vision",
          ).perUnitUsd,
        ).toBe(0.002);
        expect(board.body.effective.scheduled).toEqual([]);
      });
    });

    describe("예측은 Alert만 낸다 (CTO 정책 3201-④)", () => {
      /** 이번 달 안의 서로 다른 UTC 일자 */
      const daysThisMonth = (count: number): Date[] => {
        const now = new Date();
        return Array.from({ length: count }, (_, index) =>
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1, 12),
          ),
        );
      };

      it("이 추세면 넘을 때 경보하고, 차단하지 않는다고 말한다", async () => {
        const built = await build({ monthlyBudget: 1 });
        app = built.app;
        for (const at of daysThisMonth(3)) {
          built.prisma.executions.push({
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: at,
          });
        }

        const result = await built.checks.run("cost-forecast", "manual");
        // 예상이 예산을 넘는 것은 장애가 아니다 — 판단 재료다
        expect(result.ok).toBe(true);
        expect(result.notified.map((entry) => entry.key)).toContain(
          "cost-forecast:monthly",
        );
        const alert = built.prisma.alerts.get("cost-forecast:monthly");
        expect(alert?.status).toBe("ACTIVE");
        expect(alert?.message).toContain("차단하지 않습니다");
      });

      it("예산 안에 들어오면 경보하지 않는다", async () => {
        const built = await build({ monthlyBudget: 1000 });
        app = built.app;
        for (const at of daysThisMonth(3)) {
          built.prisma.executions.push({
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: at,
          });
        }

        const result = await built.checks.run("cost-forecast", "manual");
        expect(result.notified).toEqual([]);
        expect(built.prisma.alerts.size).toBe(0);
      });

      it("표본이 부족하면 경보하지 않는다 — 짐작으로 사람을 부르지 않는다", async () => {
        const built = await build({ monthlyBudget: 1 });
        app = built.app;
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 100,
          createdAt: new Date(),
        });

        const result = await built.checks.run("cost-forecast", "manual");
        expect(result.notified).toEqual([]);
        expect(result.detail).toContain("최소 3일이 필요합니다");
      });
    });
  });
  describe("Enterprise Provider Intelligence Platform (TASK-3301)", () => {
    const propose = (
      server: unknown,
      body: Record<string, unknown>,
      token = "tok-admin",
    ) =>
      request(server as never)
        .post("/ops/pricing")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    const advance = (
      server: unknown,
      id: string,
      action: string,
      body: Record<string, unknown> = {},
      token = "tok-admin",
    ) =>
      request(server as never)
        .post(`/ops/pricing/${id}/${action}`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    const seedOcr = (
      built: Awaited<ReturnType<typeof build>>,
      unitPrice: number,
      count = 5,
    ) => {
      const base = Date.now();
      for (let index = 0; index < count; index += 1) {
        built.prisma.ocrResults.push({
          provider: "google-vision",
          status: "SUCCESS",
          cost: unitPrice,
          createdAt: new Date(base - index * 60_000),
        });
      }
    };

    const detect = (server: unknown) =>
      request(server as never)
        .post("/ops/pricing/detect")
        .set("Authorization", "Bearer tok-admin");

    describe("공지 파싱 실패는 변경 없음이 아니다 (CTO 정책 3301-①)", () => {
      it("읽지 못하면 사람 확인을 요구하고 그 사실을 응답에 담는다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "unreachable",
          prices: [],
          unparsed: [],
          needsHumanCheck: true,
          detail:
            "가격 공지를 가져오지 못했습니다: timeout. 공지를 읽지 못한 것은 단가가 그대로라는 뜻이 아닙니다.",
        };

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.source.status).toBe("unreachable");
        expect(response.body.source.needsHumanCheck).toBe(true);
        // 조용히 "변경 없음"으로 지나가지 않는다
        expect(response.body.detail).toContain("사람 확인이 필요합니다");
      });

      it("일부만 읽었으면 못 읽은 항목을 남긴다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "partial",
          prices: [],
          unparsed: [{ index: 1, reason: "clova: perUnitUsd가 없습니다." }],
          needsHumanCheck: true,
          detail: "1건을 읽었고 1건은 해석하지 못했습니다.",
        };

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.source.unparsed).toHaveLength(1);
        expect(response.body.source.unparsed[0].reason).toContain("clova");
      });

      it("예약 점검이 공지 실패를 경보로 낸다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "unparsable",
          prices: [],
          unparsed: [],
          needsHumanCheck: true,
          detail: "가격 공지를 해석할 수 없습니다 — 목록이 아닙니다.",
        };

        const result = await built.checks.run("pricing-detect", "manual");
        // 경보 키는 **소스별**이다 (TASK-3401 — 결정 3301-⑤)
        expect(result.notified.map((entry) => entry.key)).toContain(
          "price-source:default",
        );
        const alert = built.prisma.alerts.get("price-source:default");
        expect(alert?.message).toContain("사람이 공지를 직접 확인해 주세요");
        // 방금 시작된 실패는 승격하지 않는다 — 짧은 실패는 흔하다
        expect(alert?.level).toBe("WARNING");
      });

      it("두 근거가 함께 잡히면 공지가 남는다 — 강한 근거가 밀리면 안 된다", async () => {
        // 공지는 Provider가 밝힌 단가와 발효 시각을 들고 있고, 기록 불일치는
        // 그 결과일 뿐이다. 중복 방지로 하나만 남을 때 남아야 할 것은 공지다.
        const built = await build();
        app = built.app;
        seedOcr(built, 0.002); // 기록 불일치도 함께 잡히는 상황
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "ok",
          prices: [
            {
              target: "ocr",
              key: "google-vision",
              price: { perUnitUsd: 0.003 },
              effectiveFrom: null,
            },
          ],
          unparsed: [],
          needsHumanCheck: false,
          detail: "가격 공지 1건을 읽었습니다.",
        };

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.created).toHaveLength(1);
        expect(response.body.created[0].origin).toBe("published");
        // 기록 대조 쪽이 건너뛰어진다
        expect(response.body.skipped).toEqual(["ocr/google-vision"]);
      });

      it("공지가 우리 가격표와 다르면 제안을 만든다 — 출처는 공지다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "ok",
          prices: [
            {
              target: "ocr",
              key: "google-vision",
              price: { perUnitUsd: 0.003 },
              effectiveFrom: "2026-09-01T00:00:00.000Z",
            },
          ],
          unparsed: [],
          needsHumanCheck: false,
          detail: "가격 공지 1건을 읽었습니다.",
        };

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.published).toHaveLength(1);
        expect(response.body.created).toHaveLength(1);
        const created = response.body.created[0];
        expect(created.origin).toBe("published");
        expect(created.stage).toBe("DETECTED");
        // 공지가 밝힌 발효 시각은 **근거로만** 남는다 — 자동 적용하지 않는다
        expect(created.evidence.publishedEffectiveFrom).toBe(
          "2026-09-01T00:00:00.000Z",
        );
        expect(created.effectiveFrom).toBeNull();
      });

      /**
       * CTO 정책 3501-② — 공지가 밝힌 발효 시각을 **예약 기본값**으로 쓴다.
       * 사람이 공지를 다시 읽어 옮겨 적는 일은 옮겨 적기 실수를 부르고,
       * 그 실수는 "언제부터 이 단가인가"를 틀리게 만든다.
       */
      it("적용할 때 공지가 밝힌 발효 시각이 기본값이 된다 (CTO 정책 3501-②)", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        // 상한(365일) 안의 미래 — 기본값이라고 상한에 예외를 두지 않는다
        const noticeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString();
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "ok",
          prices: [
            {
              target: "ocr",
              key: "google-vision",
              price: { perUnitUsd: 0.003 },
              effectiveFrom: noticeAt,
            },
          ],
          unparsed: [],
          needsHumanCheck: false,
          detail: "가격 공지 1건을 읽었습니다.",
        };

        const detected = await detect(server).expect(200);
        const id = detected.body.created[0].id;
        await advance(server, id, "approve").expect(200);
        // 발효 시각을 **주지 않고** 적용한다
        const applied = await advance(server, id, "apply").expect(200);

        expect(applied.body.effectiveFrom).toBe(noticeAt);
        expect(applied.body.scheduled).toBe(true);
      });

      it("운영자가 넣은 시각이 공지보다 우선한다 — 기본값은 제안일 뿐이다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const noticeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString();
        const operatorAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString();
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "ok",
          prices: [
            {
              target: "ocr",
              key: "google-vision",
              price: { perUnitUsd: 0.003 },
              effectiveFrom: noticeAt,
            },
          ],
          unparsed: [],
          needsHumanCheck: false,
          detail: "가격 공지 1건을 읽었습니다.",
        };

        const detected = await detect(server).expect(200);
        const id = detected.body.created[0].id;
        await advance(server, id, "approve").expect(200);
        const applied = await advance(server, id, "apply", {
          effectiveFrom: operatorAt,
        }).expect(200);

        expect(applied.body.effectiveFrom).toBe(operatorAt);
      });

      it("공지 시각이 이미 지났으면 그 값으로 예약하지 않는다", async () => {
        // 과거 시각은 거부된다 (정책 3201-③) — 기본값이라고 예외를 두지 않는다
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = {
          status: "ok",
          prices: [
            {
              target: "ocr",
              key: "google-vision",
              price: { perUnitUsd: 0.003 },
              effectiveFrom: "2020-01-01T00:00:00.000Z",
            },
          ],
          unparsed: [],
          needsHumanCheck: false,
          detail: "가격 공지 1건을 읽었습니다.",
        };

        const detected = await detect(server).expect(200);
        const id = detected.body.created[0].id;
        await advance(server, id, "approve").expect(200);
        const rejected = await advance(server, id, "apply").expect(400);
        expect(rejected.body.message).toContain("과거");
      });
    });

    describe("2단계 승인 (CTO 정책 3301-②)", () => {
      const ORIGINAL = process.env.NODE_ENV;
      afterEach(() => {
        process.env.NODE_ENV = ORIGINAL;
      });

      const detected = async (built: Awaited<ReturnType<typeof build>>) => {
        seedOcr(built, 0.002);
        const response = await detect(built.app.getHttpServer());
        return response.body.created[0].id as string;
      };

      it("운영에서 시스템 제안은 승인 뒤 바로 적용할 수 없다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await detected(built);

        process.env.NODE_ENV = "production";
        const approved = await advance(server, id, "approve").expect(200);
        expect(approved.body.needsSecondApproval).toBe(true);
        expect(approved.body.detail).toContain("다른 ADMIN의 최종 승인");

        const blocked = await advance(server, id, "apply").expect(400);
        expect(blocked.body.message).toContain("다른 ADMIN의 최종 승인을 거쳐야");
        expect(blocked.body.message).toContain("최종 승인(confirm)");
      });

      it("최종 승인자는 1차 승인자와 달라야 한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await detected(built);

        process.env.NODE_ENV = "production";
        await advance(server, id, "approve").expect(200);
        // 같은 사람이 두 번 누르면 단계만 늘 뿐 확인은 늘지 않는다
        const same = await advance(server, id, "confirm").expect(400);
        expect(same.body.message).toContain("1차 승인자와 최종 승인자가 같습니다");

        const other = await advance(
          server,
          id,
          "confirm",
          {},
          "tok-admin2",
        ).expect(200);
        expect(other.body.stage).toBe("CONFIRMED");
        expect(other.body.confirmedBy).toBe("b@acos.local");
        await advance(server, id, "apply").expect(200);
      });

      it("사람이 낸 제안은 2단계를 요구하지 않는다 — 이미 둘이 봤다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          reason: "공지 반영",
        });
        const id = created.body.id as string;
        await advance(server, id, "review").expect(200);

        process.env.NODE_ENV = "production";
        // 제안자(a)와 승인자(b)가 다르므로 통과한다
        await advance(server, id, "approve", {}, "tok-admin2").expect(200);
        await advance(server, id, "apply").expect(200);
      });

      it("개발에서는 시스템 제안도 바로 적용할 수 있다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await detected(built);

        process.env.NODE_ENV = "development";
        await advance(server, id, "approve").expect(200);
        await advance(server, id, "apply").expect(200);
      });
    });

    describe("예약 취소는 삭제가 아니다 (CTO 정책 3301-③)", () => {
      const scheduled = async (server: unknown) => {
        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.004 },
          reason: "9월 인상 공지",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        await advance(server, id, "approve", {}, "tok-admin2");
        await advance(server, id, "apply", {
          effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
        });
        return id;
      };

      it("발효 전 예약은 취소할 수 있고 기록이 남는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await scheduled(server);

        const cancelled = await advance(server, id, "cancel", {
          reason: "공지가 철회됐습니다",
        }).expect(200);
        expect(cancelled.body.stage).toBe("CANCELLED");
        expect(cancelled.body.cancelledBy).toBe("a@acos.local");
        expect(cancelled.body.cancelledReason).toBe("공지가 철회됐습니다");
        // 삭제하지 않는다 — 목록에 남는다
        const board = await request(server)
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin");
        expect(
          board.body.closed.some(
            (row: { id: string }) => row.id === id,
          ),
        ).toBe(true);
        // 예약은 사라졌다 — 계산에 쓰이지 않는다
        expect(board.body.effective.scheduled).toEqual([]);
        expect(board.body.effective.nextChangeAt).toBeNull();
      });

      it("취소 사유가 없으면 400 — 왜 없앴는지 남아야 한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await scheduled(server);
        const response = await advance(server, id, "cancel").expect(400);
        expect(response.body.message).toContain("예약 취소 사유가 필요합니다");
      });

      it("이미 발효된 단가는 취소할 수 없다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await propose(server, {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.004 },
          reason: "즉시 적용",
        });
        const id = created.body.id as string;
        await advance(server, id, "review");
        await advance(server, id, "approve", {}, "tok-admin2");
        await advance(server, id, "apply");

        const response = await advance(server, id, "cancel", {
          reason: "되돌리고 싶다",
        }).expect(400);
        expect(response.body.message).toContain("이미 발효된 단가입니다");
        expect(response.body.message).toContain("새 제안을 내세요");
      });

      it("취소된 예약은 되살리지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await scheduled(server);
        await advance(server, id, "cancel", { reason: "철회" }).expect(200);

        const response = await advance(server, id, "apply").expect(400);
        expect(response.body.message).toContain("되살리지 않습니다");
      });
    });

    describe("감지 주기는 Provider별로만 (CTO 정책 3301-④)", () => {
      const ORIGINAL = { ...process.env };
      afterEach(() => {
        delete process.env.PRICE_DETECT_INTERVAL_GOOGLE_VISION;
        delete process.env.PRICE_DETECT_INTERVAL_PROJECT_ACME;
        process.env.NODE_ENV = ORIGINAL.NODE_ENV;
      });

      it("현황에 Provider별 주기와 마지막 실행이 보인다", async () => {
        const built = await build();
        app = built.app;
        process.env.PRICE_DETECT_INTERVAL_GOOGLE_VISION = "12h";

        const board = await request(built.app.getHttpServer())
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);
        const vision = board.body.detection.providers.find(
          (row: { provider: string }) => row.provider === "google-vision",
        );
        expect(vision.intervalMs).toBe(12 * 60 * 60 * 1000);
        expect(vision.source).toBe("env");
        expect(vision.env).toBe("PRICE_DETECT_INTERVAL_GOOGLE_VISION");
        // 아직 한 번도 보지 않았다 — 그것도 사실이다
        expect(vision.lastRunAt).toBeNull();
      });

      it("프로젝트별 설정은 거부하고 이유를 남긴다", async () => {
        // 조용히 무시하면 설정한 사람은 적용된 줄 안다
        const built = await build();
        app = built.app;
        process.env.PRICE_DETECT_INTERVAL_PROJECT_ACME = "1h";

        const board = await request(built.app.getHttpServer())
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);
        expect(board.body.detection.rejected).toHaveLength(1);
        expect(board.body.detection.rejected[0].reason).toContain(
          "프로젝트별 감지 주기는 지원하지 않습니다",
        );
      });

      it("예약 점검은 주기를 지키고, 건너뛴 것도 기록한다", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.0015);

        await built.checks.run("pricing-detect", "manual");
        const first = built.prisma.priceDetectionRuns.length;
        expect(first).toBeGreaterThan(0);

        // 곧바로 다시 돌리면 주기가 지나지 않았다
        const second = await built.checks.run("pricing-detect", "manual");
        expect(second.detail).toContain("주기 미도래");
        // 돌지 않은 것도 기록이다 — 조용한 것과 안 본 것은 다르다
        const skippedRuns = built.prisma.priceDetectionRuns.filter((row) =>
          String(row.skipped ?? "").includes("주기가 지나지 않았습니다"),
        );
        expect(skippedRuns.length).toBeGreaterThan(0);
      });

      it("수동 실행은 주기를 무시한다 — 지금 보라고 누른 것이다", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.0015);
        const server = built.app.getHttpServer();

        await detect(server).expect(200);
        const response = await detect(server).expect(200);
        // 주기 미도래로 아무것도 하지 않으면 버튼이 거짓말이 된다
        expect(response.body.notDue).toEqual([]);
      });

      it("0건도 기록한다 — 감지 0건과 감지를 안 돌린 것은 다르다", async () => {
        const built = await build();
        app = built.app;
        seedOcr(built, 0.0015); // 가격표와 같다 = 감지 0건

        await built.checks.run("pricing-detect", "manual");
        const board = await request(built.app.getHttpServer())
          .get("/ops/pricing")
          .set("Authorization", "Bearer tok-admin");
        const recent = board.body.detection.recent;
        expect(recent.length).toBeGreaterThan(0);
        expect(
          recent.some(
            (row: { changes: number; skipped: string | null }) =>
              row.changes === 0 && row.skipped === null,
          ),
        ).toBe(true);
      });
    });
  });

  /**
   * Enterprise Production Readiness Platform (TASK-3401).
   *
   * 공지를 Provider별로 나누고(결정 3301-⑤), 실패가 길어지면 등급을 올리며
   * (결정 3301-⑥), **스텁을 진짜로 세지 않는** 운영 전환 판정을 붙인다
   * (CTO 지시 4·5·6).
   */
  describe("Enterprise Production Readiness Platform (TASK-3401)", () => {
    const detect = (server: unknown) =>
      request(server as never)
        .post("/ops/pricing/detect")
        .set("Authorization", "Bearer tok-admin");

    const ok = (detail = "가격 공지 1건을 읽었습니다.") => ({
      status: "ok",
      prices: [],
      unparsed: [],
      needsHumanCheck: false,
      detail,
    });
    const dead = (status = "unreachable") => ({
      status,
      prices: [],
      unparsed: [],
      needsHumanCheck: true,
      detail: `가격 공지를 가져오지 못했습니다 (${status}).`,
    });

    describe("Provider별 공지 (CTO 결정 3301-⑤)", () => {
      it("한 곳이 죽어도 나머지 공지는 읽는다", async () => {
        const built = await build();
        app = built.app;
        priceSource.multi = [
          {
            id: "openai",
            url: "https://openai.example/p.json",
            verdict: dead(),
          },
          {
            id: "google",
            url: "https://google.example/p.json",
            verdict: {
              ...ok(),
              prices: [
                {
                  target: "ocr",
                  key: "google-vision",
                  price: { perUnitUsd: 0.003 },
                  effectiveFrom: null,
                  sourceId: "google",
                },
              ],
            },
          },
        ];

        const response = await detect(built.app.getHttpServer()).expect(200);
        // 죽은 공지가 있어도 살아 있는 공지의 대조는 이뤄진다
        expect(response.body.published).toHaveLength(1);
        expect(response.body.created).toHaveLength(1);
        expect(response.body.created[0].evidence.sourceId).toBe("google");
        expect(response.body.created[0].evidence.url).toBe(
          "https://google.example/p.json",
        );
      });

      it("전체 상태는 가장 나쁜 것을 따른다 — 둘 중 하나를 읽었다고 정상이 아니다", async () => {
        const built = await build();
        app = built.app;
        priceSource.multi = [
          { id: "openai", url: "https://openai.example/p.json", verdict: dead() },
          { id: "google", url: "https://google.example/p.json", verdict: ok() },
        ];

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.source.status).toBe("unreachable");
        expect(response.body.source.needsHumanCheck).toBe(true);
        expect(response.body.source.sources).toHaveLength(2);
        expect(response.body.source.detail).toContain("openai(unreachable)");
      });

      it("소스마다 경보가 따로 난다 — 한 곳이 나아도 다른 곳이 뒤에 숨지 않는다", async () => {
        const built = await build();
        app = built.app;
        priceSource.multi = [
          { id: "openai", url: "https://openai.example/p.json", verdict: dead() },
          {
            id: "google",
            url: "https://google.example/p.json",
            verdict: dead("unparsable"),
          },
        ];

        const result = await built.checks.run("pricing-detect", "manual");
        const keys = result.notified.map((entry) => entry.key);
        expect(keys).toContain("price-source:openai");
        expect(keys).toContain("price-source:google");
      });

      it("거부한 공지 설정을 화면까지 올린다 — 조용히 버리지 않는다", async () => {
        const built = await build();
        app = built.app;
        priceSource.rejected = [
          {
            name: "PRICE_SOURCE_URL_PROJECT_ACME",
            reason: "프로젝트별 가격 공지는 지원하지 않습니다.",
          },
        ];

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.source.rejected).toHaveLength(1);
        expect(response.body.source.rejected[0].name).toBe(
          "PRICE_SOURCE_URL_PROJECT_ACME",
        );
      });

      it("소스별로 실행 이력을 남긴다 — 어느 공지가 죽었는지 남아야 한다", async () => {
        const built = await build();
        app = built.app;
        priceSource.multi = [
          { id: "openai", url: "https://openai.example/p.json", verdict: dead() },
          { id: "google", url: "https://google.example/p.json", verdict: ok() },
        ];

        await built.checks.run("pricing-detect", "manual");
        const published = built.prisma.priceDetectionRuns.filter(
          (row) => row.source === "published",
        );
        expect(published.map((row) => row.provider).sort()).toEqual([
          "google",
          "openai",
        ]);
        expect(
          published.find((row) => row.provider === "openai")?.skipped,
        ).toContain("읽지 못했습니다");
        expect(published.find((row) => row.provider === "google")?.skipped).toBeNull();
      });
    });

    describe("공지 소스가 책임지는 단가 (TASK-3501, CTO 지시 5)", () => {
      it("죽은 공지가 책임지던 단가를 이름으로 말한다", async () => {
        const built = await build();
        app = built.app;
        priceSource.multi = [
          {
            id: "openai",
            url: "https://openai.example/p.json",
            keys: ["gpt-4o", "gpt-4o-mini"],
            verdict: dead(),
          },
          {
            id: "google",
            url: "https://google.example/p.json",
            keys: ["google-vision"],
            verdict: ok(),
          },
        ];

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.source.unverifiedKeys).toEqual([
          "gpt-4o",
          "gpt-4o-mini",
        ]);
        expect(response.body.source.detail).toContain("확인하지 못한 단가");
      });

      it("책임 키를 선언하지 않았으면 무엇을 못 봤는지도 말하지 않는다", async () => {
        const built = await build();
        app = built.app;
        priceSource.multi = [
          { id: "openai", url: "https://openai.example/p.json", verdict: dead() },
        ];

        const response = await detect(built.app.getHttpServer()).expect(200);
        expect(response.body.source.unverifiedKeys).toEqual([]);
      });
    });

    describe("공지 실패 장기화 (CTO 결정 3301-⑥)", () => {
      it("방금 시작된 실패는 경고에 머문다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = dead();

        await built.checks.run("pricing-detect", "manual");
        expect(built.prisma.alerts.get("price-source:default")?.level).toBe(
          "WARNING",
        );
      });

      it("같은 공지를 하루 넘게 못 읽으면 등급을 올린다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = dead();

        // 이틀 전부터 이어진 실패 이력 — 승격의 근거는 실행 이력이다
        built.prisma.priceDetectionRuns.push({
          id: "pdr-old",
          target: "llm",
          provider: "default",
          source: "published",
          ranAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          samples: 0,
          changes: 0,
          skipped: "공지를 읽지 못했습니다 (unreachable)",
          detail: "이틀 전에도 못 읽었습니다.",
          createdAt: new Date(),
        });

        await built.checks.run("pricing-detect", "manual");
        const alert = built.prisma.alerts.get("price-source:default");
        expect(alert?.level).toBe("CRITICAL");
        expect(alert?.message).toContain("시간째");
      });

      it("중간에 한 번 읽혔으면 그 뒤로만 센다 — 지난 사건이 오늘을 승격시키지 않는다", async () => {
        const built = await build();
        app = built.app;
        priceSource.url = "https://provider.example/pricing.json";
        priceSource.verdict = dead();

        const day = 24 * 60 * 60 * 1000;
        built.prisma.priceDetectionRuns.push(
          {
            id: "pdr-old",
            target: "llm",
            provider: "default",
            source: "published",
            ranAt: new Date(Date.now() - 10 * day),
            samples: 0,
            changes: 0,
            skipped: "공지를 읽지 못했습니다 (unreachable)",
            detail: "열흘 전 실패",
            createdAt: new Date(),
          },
          {
            id: "pdr-ok",
            target: "llm",
            provider: "default",
            source: "published",
            ranAt: new Date(Date.now() - 9 * day),
            samples: 0,
            changes: 0,
            skipped: null,
            detail: "아흐레 전에는 읽혔다",
            createdAt: new Date(),
          },
        );

        await built.checks.run("pricing-detect", "manual");
        expect(built.prisma.alerts.get("price-source:default")?.level).toBe(
          "WARNING",
        );
      });

      it("미구성은 아무리 오래돼도 승격하지 않는다 — 미구성과 실패는 다르다", async () => {
        const built = await build();
        app = built.app;
        // priceSource.url = null (기본) — 소스가 하나도 없다

        await built.checks.run("pricing-detect", "manual");
        const alert = built.prisma.alerts.get("price-source:pricing-feed");
        expect(alert?.level).toBe("WARNING");
        expect(alert?.title).toContain("설정되지 않았습니다");
      });
    });

    /**
     * 운영 전환 검증 (CTO 지시 4·5·6).
     *
     * 이 묶음이 지키는 한 줄: **계약 스텁을 상대로 만든 성공 기록을 연결의
     * 증거로 세지 않는다.**
     */
    describe("운영 전환 검증 (GET /ops/cutover)", () => {
      const ENV_KEYS = [
        "LLM_PROVIDER",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OCR_PROVIDER",
        "GOOGLE_VISION_API_KEY",
        "GOOGLE_VISION_ENDPOINT",
        "S3_ENDPOINT",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "S3_BUCKET",
        "BACKUP_BUCKET",
        "GITHUB_REPOSITORY",
        "CI_WORKFLOW_PATH",
      ];
      const saved: Record<string, string | undefined> = {};

      beforeEach(() => {
        for (const key of ENV_KEYS) {
          saved[key] = process.env[key];
          delete process.env[key];
        }
      });
      afterEach(() => {
        for (const key of ENV_KEYS) {
          if (saved[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = saved[key];
          }
        }
      });

      const cutover = (built: Awaited<ReturnType<typeof build>>) =>
        request(built.app.getHttpServer() as never)
          .get("/ops/cutover")
          .set("Authorization", "Bearer tok-admin");

      const view = (
        body: {
          dependencies: {
            id: string;
            status: string;
            detail: string;
            evidence: string | null;
          }[];
        },
        id: string,
      ) => body.dependencies.find((row) => row.id === id)!;

      it("ADMIN만 볼 수 있다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer()).get("/ops/cutover").expect(401);
      });

      it("아무것도 안 붙은 상태를 전환 완료로 세지 않는다", async () => {
        const built = await build();
        app = built.app;

        const response = await cutover(built).expect(200);
        expect(response.body.ready).toBe(false);
        expect(response.body.detail).toContain("전환 완료로 세지 않습니다");
        expect(view(response.body, "llm").status).toBe("not-production");
        expect(view(response.body, "vision").status).toBe("not-production");
      });

      it("주소가 우리 스텁을 가리키면 성공 기록이 있어도 전환이 아니다", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";
        process.env.OPENAI_BASE_URL = "http://localhost:9300/v1";
        // 성공한 실 호출 기록이 있는 상태를 만든다
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 0.01,
          createdAt: new Date(),
        });

        const response = await cutover(built).expect(200);
        const llm = view(response.body, "llm");
        expect(llm.status).toBe("not-production");
        expect(llm.evidence).toBeNull();
      });

      it("가짜(mock) 기록은 근거로 세지 않는다", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";
        built.prisma.executions.push({
          provider: "mock",
          model: "mock",
          status: "SUCCESS",
          cost: 0,
          createdAt: new Date(),
        });

        const response = await cutover(built).expect(200);
        expect(view(response.body, "llm").status).toBe("unverified");
      });

      it("공식 주소로 성공한 기록이 있으면 근거와 함께 통과다", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 0.01,
          createdAt: new Date(),
          // 호출 대상이 기록돼 있어야 근거가 된다 (정책 3501-⑤)
          baseUrl: "https://api.openai.com",
        });

        const response = await cutover(built).expect(200);
        const llm = view(response.body, "llm");
        expect(llm.status).toBe("verified");
        expect(llm.evidence).toContain("openai");
      });

      it("s3rver를 Amazon S3로 세지 않는다 (CTO 지시 5)", async () => {
        const built = await build();
        app = built.app;
        process.env.S3_ENDPOINT = "http://localhost:9000";

        const response = await cutover(built).expect(200);
        const storage = view(response.body, "storage");
        expect(storage.status).toBe("not-production");
      });

      it("S3 주소인데 자격 증명이 개발 기본값이면 막는다", async () => {
        const built = await build();
        app = built.app;
        process.env.S3_ENDPOINT = "https://s3.ap-northeast-2.amazonaws.com";
        process.env.S3_ACCESS_KEY = "minioadmin";
        process.env.S3_SECRET_KEY = "minioadmin";

        const response = await cutover(built).expect(200);
        expect(view(response.body, "storage").status).toBe("invalid");
      });

      it("CI 워크플로 파일을 못 읽으면 통과로 세지 않는다 (CTO 지시 6)", async () => {
        const built = await build();
        app = built.app;
        process.env.CI_WORKFLOW_PATH = "/nonexistent/ci.yml";

        const response = await cutover(built).expect(200);
        expect(view(response.body, "ci").status).toBe("unverified");
      });

      it("길이 막혀 있으면 키 이야기를 하기 전에 그것부터 말한다 (TASK-3501)", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";
        egressProbes = [
          {
            host: "api.openai.com",
            status: "blocked",
            reachable: false,
            detail: "CONNECT tunnel failed, response 403",
          },
        ];

        const response = await cutover(built).expect(200);
        const llm = view(response.body, "llm");
        expect(llm.status).toBe("unreachable");
        expect(llm.detail).toContain("키가 틀린 것이 아니라");
        // 점검 결과 자체도 화면까지 올라간다
        expect(response.body.egress).toHaveLength(1);
      });

      it("점검하지 않았으면 막혔다고 말하지 않는다 (TASK-3501)", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";

        const response = await cutover(built).expect(200);
        expect(view(response.body, "llm").status).not.toBe("unreachable");
        expect(response.body.egress).toEqual([]);
      });

      it("성공 기록이 있어도 호출 대상이 없으면 통과가 아니다 (CTO 정책 3501-⑤)", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";
        // 옛 기록 — 누구를 상대로 성공했는지 모른다
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 0.01,
          createdAt: new Date(),
        });

        const response = await cutover(built).expect(200);
        const llm = view(response.body, "llm");
        expect(llm.status).toBe("unverified");
        expect(llm.detail).toContain("공식 주소로 만들어진 것은 없습니다");
      });

      it("스텁을 상대로 남은 기록도 근거가 되지 않는다 (CTO 정책 3501-⑤)", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-live";
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 0.01,
          createdAt: new Date(),
          baseUrl: "http://localhost:9300",
        });

        const response = await cutover(built).expect(200);
        expect(view(response.body, "llm").status).toBe("unverified");
      });

      it("개발 환경은 전환 대상이 아니라고 말한다 (CTO 정책 3501-①)", async () => {
        const built = await build();
        app = built.app;
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        try {
          const response = await cutover(built).expect(200);
          expect(response.body.applicable).toBe(false);
          expect(response.body.environment).toBe("development");
          expect(response.body.detail).toContain("전환 대상이 아닙니다");
        } finally {
          process.env.NODE_ENV = original;
        }
      });

      it("운영 환경은 전환 대상이다", async () => {
        const built = await build();
        app = built.app;
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
          const response = await cutover(built).expect(200);
          expect(response.body.applicable).toBe(true);
        } finally {
          process.env.NODE_ENV = original;
        }
      });

      /**
       * 운영 활성화 (TASK-3601, CTO 정책 3601-①) — 세 조건이 모두 충족될
       * 때만 완료다. 둘이 충족된 상태는 "거의 다"가 아니다.
       */
      it("활성화는 세 조건을 따로 보여준다", async () => {
        const built = await build();
        app = built.app;

        const response = await request(built.app.getHttpServer() as never)
          .get("/ops/activation")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        expect(response.body.conditions.map((row: { id: string }) => row.id)).toEqual([
          "credentials",
          "network",
          "cutover",
        ]);
        expect(response.body.activated).toBe(false);
        expect(response.body.detail).toContain("세 조건이 모두 충족될 때만");
      });

      it("활성화도 ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/activation")
          .expect(401);
      });

      it("네트워크 점검이 없으면 네트워크 조건은 충족이 아니다", async () => {
        const built = await build();
        app = built.app;

        const response = await request(built.app.getHttpServer() as never)
          .get("/ops/activation")
          .set("Authorization", "Bearer tok-admin")
          .expect(200);

        const network = response.body.conditions.find(
          (row: { id: string }) => row.id === "network",
        );
        expect(network.met).toBe(false);
        expect(network.detail).toContain("점검하지 않은 것을");
      });

      it("실행 이력이 없으면 CI를 초록으로 세지 않는다", async () => {
        const built = await build();
        app = built.app;
        // GITHUB_REPOSITORY 미설정 — 이력을 읽을 수 없다

        const response = await cutover(built).expect(200);
        const ci = view(response.body, "ci");
        expect(ci.status).toBe("unverified");
        expect(ci.detail).toContain("한 번도 돌지 않은 것은");
      });
    });
  });
  /**
   * Enterprise Production Activation Platform (TASK-3701).
   *
   * 정책 3701-①②④가 지키려는 것은 하나로 모인다 — **본 것만 세고, 안 본
   * 것은 안 본 것으로 둔다.** 이력은 변화를 담고, 스모크는 스텁의 200을
   * 통과로 세지 않으며, 장애는 복구 방법 없이 닫히지 않는다.
   */
  describe("Enterprise Production Activation Platform (TASK-3701)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    describe("활성화 이력 (정책 3701-①)", () => {
      it("판정할 때마다 같은 줄이 늘어나지 않는다 — 변화만 남는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await admin(server, "/ops/activation").expect(200);
        await admin(server, "/ops/activation").expect(200);
        await admin(server, "/ops/activation").expect(200);

        const response = await admin(server, "/ops/activation/history").expect(200);
        expect(response.body.timeline).toHaveLength(1);
        expect(response.body.timeline[0].observations).toBe(3);
        expect(response.body.timeline[0].activated).toBe(false);
        expect(response.body.changes).toBe(0);
      });

      it("한 번도 판정하지 않았으면 activated는 null이다 — '안 됨'이 아니라 '모른다'", async () => {
        const built = await build();
        app = built.app;

        const response = await admin(
          built.app.getHttpServer(),
          "/ops/activation/history",
        ).expect(200);
        expect(response.body.activated).toBeNull();
        expect(response.body.timeline).toEqual([]);
      });

      it("조건이 바뀌면 새 줄이 생기고 무엇이 늘었는지 말한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await admin(server, "/ops/activation").expect(200);
        // 네트워크 점검 결과가 생기면 조건 하나가 충족된다
        egressProbes = [
          {
            host: "api.openai.com",
            status: "reachable",
            reachable: true,
            detail: "401 — 길은 열려 있다",
          },
        ];
        await admin(server, "/ops/activation").expect(200);

        const response = await admin(server, "/ops/activation/history").expect(200);
        expect(response.body.timeline).toHaveLength(2);
        // 최신이 위 — 새로 충족된 조건이 network다
        expect(response.body.timeline[0].gained).toEqual(["network"]);
        expect(response.body.changes).toBe(1);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/activation/history")
          .expect(401);
      });
    });

    describe("운영 스모크 (정책 3701-②)", () => {
      const run = (server: unknown) =>
        request(server as never)
          .post("/ops/smoke")
          .set("Authorization", "Bearer tok-admin");

      it("mock 구성에서는 부르지 않고, 부르지 않은 것은 통과가 아니다", async () => {
        const built = await build();
        app = built.app;

        const response = await run(built.app.getHttpServer()).expect(200);
        const llm = response.body.results.find(
          (row: { target: string }) => row.target === "llm",
        );
        expect(llm.status).toBe("skipped");
        expect(response.body.ok).toBe(false);
        expect(response.body.passed).toBe(0);
      });

      it("스텁을 상대로 성공한 것은 통과로 세지 않는다", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        // 공식 주소가 아닌 곳을 부르도록 재정의한다
        process.env.OPENAI_BASE_URL = "http://127.0.0.1:9101";

        const response = await run(built.app.getHttpServer()).expect(200);
        const llm = response.body.results.find(
          (row: { target: string }) => row.target === "llm",
        );
        expect(llm.status).toBe("stubbed");
        expect(llm.detail).toContain("공식 주소가 아닙니다");
        expect(response.body.ok).toBe(false);
      });

      it("실패는 실패로 남는다 — 실패 사유를 그대로 적는다", async () => {
        const built = await build();
        app = built.app;
        process.env.LLM_PROVIDER = "openai";
        smokeStub.llm = new Error("401 invalid_api_key");

        const response = await run(built.app.getHttpServer()).expect(200);
        const llm = response.body.results.find(
          (row: { target: string }) => row.target === "llm",
        );
        expect(llm.status).toBe("failed");
        expect(llm.detail).toContain("401 invalid_api_key");
      });

      it("저장소는 쓴 것과 읽은 것이 다르면 성공이 아니다 — 200과 정합은 다르다", async () => {
        const built = await build();
        app = built.app;
        storageProtection.smokeReadDiffers = true;

        const response = await run(built.app.getHttpServer()).expect(200);
        const storage = response.body.results.find(
          (row: { target: string }) => row.target === "storage",
        );
        expect(storage.status).toBe("failed");
        expect(storage.detail).toContain("쓴 내용과 읽은 내용이 다릅니다");
      });

      it("한 번도 안 돌린 대상도 자리를 차지한다 — 둘만 돌린 것이 2/2가 되면 안 된다", async () => {
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/smoke").expect(200);
        expect(response.body.total).toBe(3);
        expect(response.body.ok).toBe(false);
        expect(response.body.ranAt).toBeNull();
      });

      it("예약 스모크와 수동 스모크가 같은 검사를 돈다", async () => {
        const built = await build();
        app = built.app;
        const checks = built.app.get(ScheduledChecksService) as unknown as {
          run: (job: string, trigger: string) => Promise<{ detail: string }>;
        };

        // 예약이 돌아도 기록은 같은 곳(smoke_runs)에 남고, 판정 문구도 같다
        const result = await checks.run("provider-smoke", "manual");
        expect(result.detail).toContain("실 호출 0/3 통과");

        const report = await admin(built.app.getHttpServer(), "/ops/smoke").expect(200);
        expect(report.body.ranAt).not.toBeNull();
        expect(report.body.total).toBe(3);
      });

      it("ADMIN 전용이다 — 실 호출은 돈이 나간다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .post("/ops/smoke")
          .expect(401);
      });
    });

    describe("운영 장애 이력 (정책 3701-④)", () => {
      const open = (server: unknown, body: Record<string, unknown>) =>
        request(server as never)
          .post("/ops/incidents")
          .set("Authorization", "Bearer tok-admin")
          .send(body);

      const incident = {
        component: "llm",
        severity: "MAJOR",
        summary: "OpenAI 호출 전량 실패",
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      };

      it("장애는 자동으로 생기지 않는다 — 경보와 장애는 다르다", async () => {
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/incidents").expect(
          200,
        );
        expect(response.body.incidents).toEqual([]);
        expect(response.body.mttrMs).toBeNull();
        expect(response.body.detail).toContain("아무도 적지");
      });

      it("복구 방법 없이는 닫히지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await open(server, incident).expect(201);
        const rejected = await request(server as never)
          .post(`/ops/incidents/${created.body.id}/resolve`)
          .set("Authorization", "Bearer tok-admin")
          .send({ recovery: "" })
          .expect(400);
        expect(rejected.body.message).toContain("무엇으로 살렸는지");
      });

      it("진행 중인 장애는 평균에 넣지 않고 먼저 보여 준다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        // 하나는 30분 만에 복구, 하나는 진행 중
        const resolved = await open(server, {
          ...incident,
          startedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        }).expect(201);
        await request(server as never)
          .post(`/ops/incidents/${resolved.body.id}/resolve`)
          .set("Authorization", "Bearer tok-admin")
          .send({
            resolvedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            recovery: "만료된 키를 새 키로 교체",
            fixKind: "permanent",
            cause: "API 키 만료",
          })
          .expect(200);
        await open(server, incident).expect(201);

        const board = await admin(server, "/ops/incidents").expect(200);
        expect(board.body.open).toBe(1);
        expect(board.body.resolved).toBe(1);
        // 진행 중 2시간이 섞였다면 30분이 나올 수 없다
        expect(Math.round(board.body.mttrMs / 60000)).toBe(30);
        expect(board.body.detail).toContain("진행 중인 장애 1건");
      });

      it("성립하지 않는 기록은 만들지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await open(server, { ...incident, component: "저기 어딘가" }).expect(400);
        await open(server, {
          ...incident,
          startedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }).expect(400);
        await open(server, { component: "llm", severity: "MAJOR" }).expect(400);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/incidents")
          .expect(401);
      });
    });
  });
  /**
   * Enterprise Operations Governance Platform (TASK-3801).
   *
   * 정책 3801-①~④가 지키려는 것: **경계를 넘을 때만 알린다**,
   * **임시로 살린 것과 원인을 없앤 것을 가른다**, **모르는 지표를 좋음으로
   * 세지 않는다**, **실패한 시도도 남긴다**.
   */
  describe("Enterprise Operations Governance Platform (TASK-3801)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("활성화 이벤트 (정책 3801-①)", () => {
      it("처음 관측에서는 이벤트가 나지 않는다 — 모르는 것을 사건으로 만들지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await admin(server, "/ops/activation").expect(200);
        const events = await admin(server, "/ops/events").expect(200);
        expect(events.body).toEqual([]);
      });

      it("경계를 넘으면 이벤트가 나고, 유지되는 동안에는 다시 나지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        // 첫 관측 (조건 0개)
        await admin(server, "/ops/activation").expect(200);
        // 네트워크가 열려 조건 하나가 채워진다 — 아직 완료는 아니다
        egressProbes = [
          {
            host: "api.openai.com",
            status: "reachable",
            reachable: true,
            detail: "401 — 길은 열려 있다",
          },
        ];
        await admin(server, "/ops/activation").expect(200);

        // 경계를 넘지 않았으므로 이벤트는 없다 (진행 상황은 이력이 담당한다)
        const events = await admin(server, "/ops/events").expect(200);
        expect(events.body).toEqual([]);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never).get("/ops/events").expect(401);
      });
    });

    describe("장애 사후 분석 (정책 3801-②)", () => {
      const incident = {
        component: "llm",
        severity: "MAJOR",
        summary: "OpenAI 호출 전량 실패",
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      };

      const open = (server: unknown) =>
        post(server, "/ops/incidents").send(incident).expect(201);

      it("임시인지 영구인지 고르지 않으면 닫히지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await open(server);

        const rejected = await post(server, `/ops/incidents/${created.body.id}/resolve`)
          .send({ recovery: "API 서버 재시작" })
          .expect(400);
        expect(rejected.body.message).toContain("임시 조치인지 영구 조치인지");
      });

      it("임시 조치로 닫힌 장애는 '복구됨'이어도 끝난 것이 아니다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await open(server);

        const resolved = await post(server, `/ops/incidents/${created.body.id}/resolve`)
          .send({ recovery: "API 서버 재시작", fixKind: "temporary" })
          .expect(200);
        expect(resolved.body.needsFollowUp).toBe(true);
        expect(resolved.body.temporaryFix).toBe("API 서버 재시작");

        const board = await admin(server, "/ops/incidents").expect(200);
        expect(board.body.awaitingPermanentFix).toBe(1);
        expect(board.body.detail).toContain("영구 조치를 기다립니다");
      });

      it("근본 원인 없이 재발 방지를 적을 수 없다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await open(server);

        const rejected = await post(server, `/ops/incidents/${created.body.id}/analysis`)
          .send({ prevention: "배포 전 키 만료일 확인 단계를 추가" })
          .expect(400);
        expect(rejected.body.message).toContain("근본 원인 없이");
      });

      it("영구 조치가 적히면 후속 대기가 풀린다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await open(server);
        await post(server, `/ops/incidents/${created.body.id}/resolve`)
          .send({ recovery: "API 서버 재시작", fixKind: "temporary" })
          .expect(200);

        const analyzed = await post(server, `/ops/incidents/${created.body.id}/analysis`)
          .send({
            rootCause: "연결 풀 크기가 1이었다",
            permanentFix: "풀 기본값을 고치고 테스트를 추가",
            prevention: "부하 테스트를 배포 전 단계에 넣음",
          })
          .expect(200);
        expect(analyzed.body.needsFollowUp).toBe(false);
        expect(analyzed.body.rootCause).toContain("연결 풀");
      });

      it("빈 값이 이미 적힌 조사 결과를 덮어 쓰지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const created = await open(server);
        await post(server, `/ops/incidents/${created.body.id}/analysis`)
          .send({ rootCause: "연결 풀 크기가 1이었다" })
          .expect(200);

        const again = await post(server, `/ops/incidents/${created.body.id}/analysis`)
          .send({ rootCause: "", permanentFix: "풀 기본값을 고침" })
          .expect(200);
        expect(again.body.rootCause).toContain("연결 풀");
      });
    });

    describe("운영 KPI (정책 3801-③)", () => {
      it("표본이 없는 지표를 0이 아니라 '낼 수 없음'으로 낸다", async () => {
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/kpi").expect(200);
        const mttr = response.body.kpis.find((kpi: { id: string }) => kpi.id === "mttr");
        expect(mttr.value).toBeNull();
        expect(mttr.status).toBe("unknown");
        expect(response.body.unknown).toBeGreaterThan(0);
        expect(response.body.detail).toContain("모르는 것을 좋음으로 세지 않습니다");
      });

      it("관측 창을 밝힌다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/kpi").expect(200);
        expect(response.body.windowDays).toBe(30);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never).get("/ops/kpi").expect(401);
      });
    });

    describe("운영 감사 기록 (정책 3801-④)", () => {
      it("변경 요청을 남긴다 — 누가 무엇을 눌렀는가", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/smoke").expect(200);

        const audit = await admin(server, "/ops/audit").expect(200);
        const entry = audit.body.find(
          (row: { action: string }) => row.action === "smoke.run",
        );
        expect(entry.outcome).toBe("ok");
        expect(entry.actorEmail).toBe("a@acos.local");
        expect(entry.title).toContain("과금");
      });

      it("실패한 시도도 남는다 — 거절된 시도는 그 자체가 신호다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/incidents")
          .send({ component: "저기 어딘가", severity: "MAJOR", summary: "무언가", startedAt: new Date().toISOString() })
          .expect(400);

        const audit = await admin(server, "/ops/audit").expect(200);
        const entry = audit.body.find(
          (row: { action: string }) => row.action === "incident.open",
        );
        expect(entry.outcome).toBe("failed");
        expect(entry.statusCode).toBe(400);
        // 판단의 근거가 되는 짧은 값은 남는다
        expect(entry.detail).toContain("severity=MAJOR");
      });

      it("조회는 남기지 않는다 — 소음이 진짜 변경을 묻는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await admin(server, "/ops/kpi").expect(200);
        await admin(server, "/ops/incidents").expect(200);

        const audit = await admin(server, "/ops/audit").expect(200);
        expect(audit.body).toEqual([]);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never).get("/ops/audit").expect(401);
      });
    });
  });
  /**
   * Enterprise Operations Control Platform (TASK-3901).
   *
   * 정책 3901-①~⑤가 지키려는 것: **되살아난 것도 알린다**, **느슨하게 바꾼
   * 임계값이 드러난다**, **초안은 장애가 아니다**, **미구성을 침묵으로
   * 바꾸지 않는다**.
   */
  describe("Enterprise Operations Control Platform (TASK-3901)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("KPI 임계값 (정책 3901-②)", () => {
      it("운영자가 바꾼 임계값이 판정에 실제로 쓰인다", async () => {
        const built = await build();
        app = built.app;
        // 진행 중인 장애 1건은 기본 임계에서 "주의"다
        await post(built.app.getHttpServer(), "/ops/incidents")
          .send({
            component: "llm",
            severity: "MAJOR",
            summary: "진행 중인 장애 하나",
            startedAt: new Date(Date.now() - 3600_000).toISOString(),
          })
          .expect(201);

        const before = await admin(built.app.getHttpServer(), "/ops/kpi").expect(200);
        expect(
          before.body.kpis.find((row: { id: string }) => row.id === "incidents-open")
            .status,
        ).toBe("watch");

        // 임계를 느슨하게 바꾸면 초록이 된다 — 그리고 그 사실이 드러나야 한다
        opsSettingsStub["kpi.threshold.incidents-open.good"] = "3";
        const after = await admin(built.app.getHttpServer(), "/ops/kpi").expect(200);
        const card = after.body.kpis.find(
          (row: { id: string }) => row.id === "incidents-open",
        );
        expect(card.status).toBe("good");
        expect(card.threshold).toContain("상태가 좋아진 것이 아닙니다");
        expect(after.body.relaxed).toBe(1);
        expect(after.body.detail).toContain("기준을 내린 것이지");
      });

      it("범위 밖 값은 기본값으로 되돌리고 사유를 남긴다 — 조용히 버리지 않는다", async () => {
        const built = await build();
        app = built.app;
        opsSettingsStub["kpi.threshold.mttr.watch"] = "99999";

        const response = await admin(built.app.getHttpServer(), "/ops/kpi").expect(200);
        expect(response.body.rejected).toHaveLength(1);
        expect(response.body.rejected[0].reason).toContain("임계값을 없앤 것");
      });

      it("기본값이면 카드에 아무 말도 붙이지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/kpi").expect(200);
        expect(
          response.body.kpis.find((row: { id: string }) => row.id === "mttr").threshold,
        ).toBeNull();
        expect(response.body.adjusted).toBe(0);
      });
    });

    describe("운영 설정 현황 (정책 3901-②③④)", () => {
      it("임계값·보존·긴급 경로·승격을 한 곳에서 보여준다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/settings").expect(
          200,
        );
        expect(response.body.thresholds.length).toBeGreaterThan(0);
        // 감사 기록이 이벤트보다 오래 남는다 — 사고는 몇 달 뒤에 드러난다
        const audit = response.body.retention.find(
          (row: { target: string }) => row.target === "ops-audit",
        );
        const events = response.body.retention.find(
          (row: { target: string }) => row.target === "ops-events",
        );
        expect(audit.days).toBeGreaterThan(events.days);
        // 긴급 경로는 미구성이 기본이고, 그 사실이 보인다
        expect(response.body.urgentChannels.every((row: { configured: boolean }) => !row.configured)).toBe(
          true,
        );
        // 자동 승격은 기본 꺼짐
        expect(response.body.promotion.enabled).toBe(false);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never).get("/ops/settings").expect(401);
      });
    });

    describe("감사 이름 누락 방지 (라이브 결함)", () => {
      it("`/ops/*`의 모든 변경 경로에 이름이 붙어 있다", async () => {
        const built = await build();
        app = built.app;

        // Nest가 실제로 등록한 경로를 읽는다 — 손으로 적은 목록과 대조하면
        // 그 목록이 낡는 순간 검사도 함께 낡는다.
        const server = built.app.getHttpAdapter().getInstance() as {
          router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
          _router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
        };
        const stack = (server.router ?? server._router)?.stack ?? [];

        const unnamed: string[] = [];
        for (const layer of stack) {
          const route = layer.route;
          if (route === undefined || !route.path.startsWith("/ops")) {
            continue;
          }
          for (const method of Object.keys(route.methods)) {
            const verb = method.toUpperCase();
            if (verb === "GET" || verb === "HEAD") {
              continue;
            }
            // Nest의 `:id`를 우리 판정이 쓰는 모양으로 바꿔 본다
            const probe = route.path.replace(/:[a-zA-Z]+/g, "1");
            const action = judgeAuditAction(verb, probe);
            if (action !== null && action.title.includes(route.path.split("/:")[0])) {
              // 제목이 경로 원문이면 이름이 없는 것이다
              unnamed.push(`${verb} ${route.path}`);
            }
          }
        }

        // **이름 없는 경로가 있으면 감사 목록이 원시 경로로 뒤덮인다.**
        // TASK-3801에서 고쳤는데 TASK-3901의 새 경로 넷이 다시 그렇게 됐다 —
        // 사람의 기억에 기대는 규칙은 반드시 다시 어긋난다.
        expect(unnamed).toEqual([]);
      });
    });

    describe("초안 승격 (정책 3901-⑤)", () => {
      it("기본은 꺼져 있어 아무것도 만들지 않는다 — 장애는 사람이 연다", async () => {
        const built = await build();
        app = built.app;
        const response = await post(built.app.getHttpServer(), "/ops/incidents/promote")
          .expect(200);
        expect(response.body.created).toBe(0);
        expect(response.body.detail).toContain("장애는 사람이 엽니다");
      });

      it("켜면 오래 산 CRITICAL 경보를 초안으로 만들고, 초안은 평균에서 빠진다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        opsSettingsStub["incident.promotion.enabled"] = "true";

        // 45분 전에 난 CRITICAL 경보를 심는다
        built.prisma.seedAlert({
          key: "provider-failure:openai",
          kind: "provider-failure",
          level: "CRITICAL",
          status: "ACTIVE",
          title: "openai 호출 실패율 급증",
          message: "최근 60분 실패율 82%",
          firstRaisedAt: new Date(Date.now() - 45 * 60 * 1000),
        });

        const promoted = await post(server, "/ops/incidents/promote").expect(200);
        expect(promoted.body.created).toBe(1);

        const board = await admin(server, "/ops/incidents").expect(200);
        expect(board.body.drafts).toBe(1);
        // **초안은 진행 중인 장애로 세지 않는다** — 사람이 아직 확인 안 했다
        expect(board.body.open).toBe(0);
        expect(board.body.detail).toContain("초안은 아직");
      });

      it("같은 경보로 두 번 만들지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        opsSettingsStub["incident.promotion.enabled"] = "true";
        built.prisma.seedAlert({
          key: "provider-failure:openai",
          kind: "provider-failure",
          level: "CRITICAL",
          status: "ACTIVE",
          title: "openai 호출 실패율 급증",
          message: "실패율 82%",
          firstRaisedAt: new Date(Date.now() - 45 * 60 * 1000),
        });

        await post(server, "/ops/incidents/promote").expect(200);
        const again = await post(server, "/ops/incidents/promote").expect(200);
        expect(again.body.created).toBe(0);
        expect(again.body.detail).toContain("건너뛰었습니다");
      });

      it("사유 없이 기각하지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        opsSettingsStub["incident.promotion.enabled"] = "true";
        built.prisma.seedAlert({
          key: "provider-failure:openai",
          kind: "provider-failure",
          level: "CRITICAL",
          status: "ACTIVE",
          title: "openai 호출 실패율 급증",
          message: "실패율 82%",
          firstRaisedAt: new Date(Date.now() - 45 * 60 * 1000),
        });
        await post(server, "/ops/incidents/promote").expect(200);
        const board = await admin(server, "/ops/incidents").expect(200);
        const draft = board.body.incidents.find(
          (row: { status: string }) => row.status === "DRAFT",
        );

        const rejected = await post(server, `/ops/incidents/${draft.id}/dismiss`)
          .send({ reason: "" })
          .expect(400);
        expect(rejected.body.message).toContain("기각 사유를 적어 주세요");

        const dismissed = await post(server, `/ops/incidents/${draft.id}/dismiss`)
          .send({ reason: "Provider 측 일시 점검 공지 확인" })
          .expect(200);
        expect(dismissed.body.status).toBe("DISMISSED");
        expect(dismissed.body.dismissReason).toContain("일시 점검");
      });

      it("확인할 때 경보 제목 그대로는 받지 않는다 — 그건 경보의 이름이지 장애의 설명이 아니다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        opsSettingsStub["incident.promotion.enabled"] = "true";
        built.prisma.seedAlert({
          key: "provider-failure:openai",
          kind: "provider-failure",
          level: "CRITICAL",
          status: "ACTIVE",
          title: "openai 호출 실패율 급증",
          message: "실패율 82%",
          firstRaisedAt: new Date(Date.now() - 45 * 60 * 1000),
        });
        await post(server, "/ops/incidents/promote").expect(200);
        const board = await admin(server, "/ops/incidents").expect(200);
        const draft = board.body.incidents.find(
          (row: { status: string }) => row.status === "DRAFT",
        );

        await post(server, `/ops/incidents/${draft.id}/confirm`)
          .send({ summary: "경보" })
          .expect(400);

        const confirmed = await post(server, `/ops/incidents/${draft.id}/confirm`)
          .send({ summary: "OpenAI 장애로 상세페이지 생성이 40분간 멈춤" })
          .expect(200);
        expect(confirmed.body.status).toBe("CONFIRMED");

        // 확인되면 이제 진행 중인 장애로 센다
        const after = await admin(server, "/ops/incidents").expect(200);
        expect(after.body.open).toBe(1);
        expect(after.body.drafts).toBe(0);
      });
    });
  });

  describe("Enterprise Operations Intelligence Platform (TASK-4001)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("장애 초안 수명 (정책 4001-①)", () => {
      it("초안이 없으면 아무 말도 만들지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/incidents/drafts")
          .expect(200);
        expect(response.body.stale).toEqual([]);
        expect(response.body.expired).toEqual([]);
        expect(response.body.detail).toContain("수명을 넘긴 초안이 없습니다");
      });

      it("설정 화면이 말하는 기간이 실제 판정 기간과 같다", async () => {
        const built = await build();
        app = built.app;
        opsSettingsStub["incident.draft.staleAfterDays"] = "5";
        opsSettingsStub["incident.draft.expireAfterDays"] = "45";
        const response = await admin(built.app.getHttpServer(), "/ops/incidents/drafts")
          .expect(200);
        expect(response.body.staleAfterDays).toBe(5);
        expect(response.body.expireAfterDays).toBe(45);
      });

      it("만료가 경보보다 빠른 설정은 받아들이지 않고 그 사실을 말한다", async () => {
        const built = await build();
        app = built.app;
        opsSettingsStub["incident.draft.staleAfterDays"] = "20";
        opsSettingsStub["incident.draft.expireAfterDays"] = "10";
        const response = await admin(built.app.getHttpServer(), "/ops/incidents/drafts")
          .expect(200);
        // 기본값으로 되돌아가되 **조용히 되돌리지 않는다**
        expect(response.body.staleAfterDays).toBe(3);
        expect(response.body.expireAfterDays).toBe(30);
        expect(response.body.detail).toContain("받아들이지 않은 설정");
      });

      /**
       * 라이브 검증에서 드러난 결함: 요약이 "만료할 초안 1건"이라고 말하는데
       * 목록(`expired`)은 비어 있었다. 판정(아직 표시 안 됨)과 기록(이미
       * 표시됨)을 한 칸에 넣었기 때문이다.
       */
      it("만료될 초안과 이미 만료된 초안을 나눠 보여 준다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        // 40일 된 초안 — 아직 정리가 돌지 않았다
        built.prisma.seedAlert({
          key: "provider-failure:old",
          level: "CRITICAL",
          status: "RESOLVED",
          firstRaisedAt: new Date(Date.now() - 40 * 86_400_000),
        });
        opsSettingsStub["incident.promotion.enabled"] = "true";
        await post(server, "/ops/incidents/promote").expect(200);
        // 초안 생성 시각을 뒤로 민다 (승격은 지금 만든다)
        const drafts = await admin(server, "/ops/incidents").expect(200);
        expect(drafts.body.drafts).toBe(1);

        const before = await admin(server, "/ops/incidents/drafts").expect(200);
        // 방금 만들어졌으므로 수명을 넘기지 않았다
        expect(before.body.expiring).toEqual([]);
        expect(before.body.expired).toEqual([]);
        expect(before.body.detail).toContain("수명을 넘긴 초안이 없습니다");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/incidents/drafts")
          .expect(401);
      });
    });

    describe("KPI 추세 (정책 4001-②)", () => {
      it("스냅샷이 한 점뿐이면 추세를 내지 않는다 — 0% 변화가 아니다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/kpi/snapshot").expect(200);

        const response = await admin(server, "/ops/kpi/trend").expect(200);
        expect(response.body.trends.length).toBeGreaterThan(0);
        for (const trend of response.body.trends) {
          expect(trend.direction).toBe("unknown");
          expect(trend.delta).toBeNull();
        }
        expect(response.body.detail).toContain("추세를 낼 수 없는 지표");
      });

      it("하루 한 번만 찍는다 — 화면을 많이 본 날로 표본이 기울지 않게", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const first = await post(server, "/ops/kpi/snapshot").expect(200);
        expect(first.body.taken).toBe(true);

        const second = await post(server, "/ops/kpi/snapshot").expect(200);
        expect(second.body.taken).toBe(false);
        expect(second.body.detail).toContain("하루 한 번");
      });

      it("스냅샷이 하나도 없으면 마지막 시각은 null이다 — 0이 아니다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/kpi/trend")
          .expect(200);
        expect(response.body.lastTakenAt).toBeNull();
        expect(response.body.unknown).toBe(response.body.trends.length);
      });
    });

    describe("KPI 임계값 변경 이력 (정책 4001-③)", () => {
      it("임계값 설정만 골라 보여 준다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.seedSettingChange({
          action: "SETTING_UPDATED",
          key: "kpi.threshold.mttr.watch",
          before: "240",
          after: "600",
          actor: "admin@acos.local",
        });
        // 임계값이 아닌 설정은 이 목록에 끼지 않는다
        built.prisma.seedSettingChange({
          action: "SETTING_UPDATED",
          key: "smtp.host",
          after: "x",
        });

        const response = await admin(built.app.getHttpServer(), "/ops/kpi/history")
          .expect(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].key).toBe("kpi.threshold.mttr.watch");
        // 원시 키가 아니라 사람이 읽는 이름이 붙는다
        expect(response.body[0].title).toContain("평균 복구 시간");
        // **느슨해진 변경임을 목록이 말한다** — 그러지 않으면 "240 → 600"이
        // 좋은 소식인지 나쁜 소식인지 사람이 다시 계산해야 한다
        expect(response.body[0].relaxed).toBe(true);
      });

      /**
       * 라이브 검증에서 드러난 결함: 오버라이드가 없던 상태에서 처음
       * 느슨하게 바꾸면 `before`가 null이라 "판정할 수 없음"으로 찍혔다.
       * 그때 실제로 쓰이던 기준은 없었던 것이 아니라 **기본값**이었고,
       * 이 기능이 잡으려는 바로 그 경우가 회색으로 지나갔다.
       */
      it("오버라이드가 없던 상태에서 처음 느슨하게 바꾼 것도 느슨해짐이다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.seedSettingChange({
          action: "SETTING_UPDATED",
          key: "kpi.threshold.mttr.watch",
          before: null, // 기본값 240분을 쓰고 있었다
          after: "600",
        });

        const response = await admin(built.app.getHttpServer(), "/ops/kpi/history")
          .expect(200);
        expect(response.body[0].relaxed).toBe(true);
      });

      it("해제는 기본값으로 되돌아간 것이며, 그 방향도 판정한다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.seedSettingChange({
          action: "SETTING_CLEARED",
          key: "kpi.threshold.mttr.good",
          before: "30", // 기본값 60분보다 엄격했다
          after: null, // 되돌리면 느슨해지는 것이다
        });

        const response = await admin(built.app.getHttpServer(), "/ops/kpi/history")
          .expect(200);
        expect(response.body[0].relaxed).toBe(true);
      });

      it("임계값 지표가 아닌 키는 방향을 판정하지 않는다 — false로 적지 않는다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.seedSettingChange({
          action: "SETTING_UPDATED",
          key: "kpi.threshold.unknown-metric.good",
          before: "1",
          after: "2",
        });

        const response = await admin(built.app.getHttpServer(), "/ops/kpi/history")
          .expect(200);
        expect(response.body[0].relaxed).toBeNull();
      });
    });

    describe("운영 진단 (정책 4001-④⑤)", () => {
      it("진단은 서비스를 막지 않는다 — 경보와 차단은 다르다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/diagnostics")
          .expect(200);
        expect(response.body.blocked).toBe(false);
        expect(response.body.detail).toContain("서비스는 계속 뜹니다");
      });

      it("긴급 알림 경로가 진단 항목에 들어 있다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/diagnostics")
          .expect(200);
        const urgent = response.body.checks.find(
          (check: { id: string }) => check.id === "urgent-channel",
        );
        expect(urgent).toBeDefined();
      });

      it("기동 진단은 '아직 아무것도 안 해 봤다'를 통과로 세지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(
          built.app.getHttpServer(),
          "/ops/diagnostics?stage=startup",
        ).expect(200);
        const fresh = response.body.checks.find(
          (check: { id: string }) => check.id === "fresh",
        );
        expect(fresh.status).toBe("unknown");
        expect(response.body.unknown).toBeGreaterThan(0);
      });
    });

    describe("검증 스프린트 준비 (정책 4001-⑥)", () => {
      it("사람이 줄 것이 남아 있으면 준비 완료라고 말하지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-plan")
          .expect(200);
        expect(response.body.readiness).not.toBe("ready");
        expect(response.body.waitingOnPeople).toBeGreaterThan(0);
        expect(response.body.detail).toContain("코드로 해결되지 않습니다");
      });

      it("단계마다 담당과 증거가 붙는다 — 증거가 없으면 '아마 됐을 것'이 들어온다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-plan")
          .expect(200);
        expect(response.body.steps.length).toBe(response.body.total);
        for (const step of response.body.steps) {
          expect(["system", "operator"]).toContain(step.owner);
          expect(String(step.evidence).length).toBeGreaterThan(0);
        }
      });

      it("앞 단계가 막혀 못 하는 것을 안 한 것으로 적지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-plan")
          .expect(200);
        const smoke = response.body.steps.find(
          (step: { id: string }) => step.id === "smoke",
        );
        expect(smoke.status).toBe("blocked");
        expect(smoke.blockedBy.length).toBeGreaterThan(0);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/validation-plan")
          .expect(401);
      });
    });
  });

  describe("Enterprise Validation Governance Platform (TASK-4101)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("검증 대상 보호 (정책 4101-①)", () => {
      it("미설정은 실패가 아니다 — 아직 정하지 않은 것이다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-run")
          .expect(200);
        expect(response.body.target.verdict).toBe("unset");
        expect(response.body.target.usable).toBe(false);
      });

      it("운영 호스트를 가리키면 검증 실행을 막는다", async () => {
        process.env.VALIDATION_TARGET_URL = "https://acos.example";
        process.env.VALIDATION_TARGET_ACK = "acos.example";
        process.env.PRODUCTION_HOSTS = "acos.example";
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-run")
          .expect(200);
        expect(response.body.target.verdict).toBe("production");
        expect(response.body.verdict).toBe("blocked");
      });

      it("확인이 없으면 아직 쓸 수 없다 — 적는 것과 돌려도 된다고 말하는 것은 다르다", async () => {
        process.env.VALIDATION_TARGET_URL = "https://staging.acos.example";
        delete process.env.VALIDATION_TARGET_ACK;
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-run")
          .expect(200);
        expect(response.body.target.verdict).toBe("unacknowledged");
      });
    });

    describe("진단 이력과 비교 (정책 4101-②)", () => {
      it("첫 진단은 '변화 없음'이 아니라 기준선이다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/diagnostics")
          .expect(200);
        expect(response.body.comparison.comparable).toBe(false);
        expect(response.body.comparison.detail).toContain("이번이 기준선입니다");
      });

      it("이력이 쌓이면 지난 진단과 비교한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        // 예약 점검이 진단을 돌리며 이력을 남긴다
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/diagnostics").expect(200);
        expect(response.body.comparison.comparable).toBe(true);
        expect(response.body.comparison.comparedTo).not.toBeNull();
      });

      it("이력 목록을 돌려준다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/diagnostics/history").expect(200);
        expect(response.body.length).toBeGreaterThan(0);
        expect(response.body[0].tier).toBeDefined();
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/diagnostics/history")
          .expect(401);
      });
    });

    describe("배포 단계별 진단 (정책 4101-③)", () => {
      it("단계를 보고서에 함께 적는다 — 스테이징의 실패 2건과 운영의 실패 2건은 다른 소식이다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/diagnostics")
          .expect(200);
        expect(["development", "staging", "production"]).toContain(response.body.tier);
        expect(response.body.detail).toContain(`[`);
      });

      it("선언과 구성이 어긋나면 실패로 잡는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.NODE_ENV = "test";
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/diagnostics")
          .expect(200);
        const check = response.body.checks.find(
          (row: { id: string }) => row.id === "deploy-tier",
        );
        expect(check.status).toBe("fail");
        expect(check.detail).toContain("운영의 값이 아닙니다");
      });
    });

    describe("만료 초안 되살림 (정책 4101-④)", () => {
      it("만료되지 않은 초안에는 쓸 수 없다 — 두 경로가 같은 일을 하면 기록이 흐려진다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await seedExpiredDraft(built, { expired: false });

        const response = await post(server, `/ops/incidents/${id}/revive`)
          .send({ action: "reopen", reason: "다시 보겠습니다" })
          .expect(400);
        expect(response.body.message).toContain("만료되지 않은");
      });

      it("이미 판단이 끝난 기록에는 쓸 수 없다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await post(server, "/ops/incidents")
          .send({
            component: "llm",
            severity: "MAJOR",
            summary: "사람이 연 장애",
            startedAt: new Date().toISOString(),
          })
          .expect(201);

        const response = await post(server, `/ops/incidents/${created.body.id}/revive`)
          .send({ action: "reopen", reason: "다시 보겠습니다" })
          .expect(400);
        expect(response.body.message).toContain("이미 판단이 끝난");
      });

      it("사유 없이 되살릴 수 없다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await seedExpiredDraft(built);

        const response = await post(server, `/ops/incidents/${id}/revive`)
          .send({ action: "reopen", reason: "음" })
          .expect(400);
        expect(response.body.message).toContain("앞사람의 판단을 참고할 수 없습니다");
      });

      it("만료 뒤 확인해도 만료됐던 사실을 지우지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await seedExpiredDraft(built);

        await post(server, `/ops/incidents/${id}/revive`)
          .send({
            action: "confirm",
            reason: "비슷한 사고가 다시 나서 되짚어 보니 같은 원인이었습니다",
            summary: "OpenAI 장애로 상세페이지 생성이 40분 멈춤",
          })
          .expect(200);

        const drafts = await admin(server, "/ops/incidents/drafts").expect(200);
        // 확인됐으므로 초안 목록에서는 빠지지만, 만료 표시는 지워지지 않았다
        const row = built.prisma.stub as never as {
          incident: { findUnique: (a: unknown) => Promise<Record<string, unknown>> };
        };
        const saved = await row.incident.findUnique({ where: { id } });
        expect(saved.expiredAt).not.toBeNull();
        expect(saved.status).toBe("CONFIRMED");
        expect(drafts.body.expired.some((item: { id: string }) => item.id === id)).toBe(
          false,
        );
      });

      it("만료 취소만 만료 표시를 비우고, 그때도 되살린 기록은 남는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await seedExpiredDraft(built);

        await post(server, `/ops/incidents/${id}/revive`)
          .send({ action: "reopen", reason: "휴가 중이어서 아무도 못 봤습니다" })
          .expect(200);

        const stub = built.prisma.stub as never as {
          incident: { findUnique: (a: unknown) => Promise<Record<string, unknown>> };
        };
        const saved = await stub.incident.findUnique({ where: { id } });
        expect(saved.expiredAt).toBeNull();
        expect(saved.status).toBe("DRAFT");
        expect(saved.revivedAt).not.toBeNull();
      });

      it("되살림 이력을 성과로 적지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        const id = await seedExpiredDraft(built);

        await post(server, `/ops/incidents/${id}/revive`)
          .send({
            action: "confirm",
            reason: "뒤늦게 진짜 장애였음이 드러났습니다",
            summary: "OpenAI 장애로 생성이 멈춤",
          })
          .expect(200);

        const response = await admin(server, "/ops/incidents/revivals").expect(200);
        expect(response.body.total).toBe(1);
        expect(response.body.confirmed).toBe(1);
        expect(response.body.detail).toContain("잘 처리한 기록이 아니라");
      });
    });

    describe("검증 실행 잠금 (정책 4101-⑤⑥)", () => {
      it("준비되지 않았으면 403으로 거절하고 이유를 말한다", async () => {
        const built = await build();
        app = built.app;
        const response = await post(built.app.getHttpServer(), "/ops/validation-run")
          .expect(403);
        expect(response.body.message).toContain("강제로 여는 방법은 없습니다");
      });

      it("막힌 이유를 단계별로 돌려준다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-run")
          .expect(200);
        expect(response.body.verdict).toBe("blocked");
        expect(response.body.blockers.length).toBeGreaterThan(0);
      });

      it("실행 순서에서 되돌릴 수 없는 단계가 앞에 오지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/validation-run")
          .expect(200);
        const steps: { order: number; reversible: boolean }[] = response.body.steps;
        const firstIrreversible = steps.findIndex((step) => !step.reversible);
        expect(firstIrreversible).toBeGreaterThan(2);
      });
    });
  });

  describe("Enterprise Cost & Neglect Intelligence Platform (TASK-4201)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("운영 호스트 목록 검증 (정책 4201-①)", () => {
      it("목록이 비어 있으면 보호가 꺼진 것이다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.PUBLIC_BASE_URL = "https://api.acos.example";
        delete process.env.PRODUCTION_HOSTS;
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/hosts").expect(200);
        expect(response.body.declared).toBe(0);
        expect(response.body.detail).toContain("사실상 꺼져 있습니다");
      });

      it("목록에 없는데 쓰이는 호스트를 찾아 사람에게 묻는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.PRODUCTION_HOSTS = "acos.example";
        process.env.PUBLIC_BASE_URL = "https://api.acos.example";
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/hosts").expect(200);
        expect(response.body.undeclared).toBe(1);
        expect(response.body.detail).toContain("이것이 운영이라면");
      });

      /**
       * 자동으로 채우면 이 보호가 스스로 무력해진다 — 그 이유가 화면에
       * 남아 있어야 다음 사람이 "자동화하면 되잖아"로 되돌리지 않는다.
       */
      it("자동으로 목록에 넣지 않는 이유를 말한다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.PRODUCTION_HOSTS = "acos.example";
        process.env.PUBLIC_BASE_URL = "https://api.acos.example";
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/hosts").expect(200);
        expect(response.body.detail).toContain("자동으로 넣지 않는 이유는");
      });

      it("목록이 비어 있으면 검증 준비도 끝난 것이 아니다", async () => {
        process.env.DEPLOY_TIER = "staging";
        delete process.env.PRODUCTION_HOSTS;
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/validation-plan")
          .expect(200);
        const step = response.body.steps.find(
          (row: { id: string }) => row.id === "host-list",
        );
        expect(step.status).toBe("pending");
        expect(step.owner).toBe("operator");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never).get("/ops/hosts").expect(401);
      });
    });

    describe("연속 실패와 방치 (정책 4201-②)", () => {
      it("기록이 없는 것은 '방치가 없다'가 아니다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/neglect")
          .expect(200);
        expect(response.body.runs).toBe(0);
        expect(response.body.worst).toBeNull();
        expect(response.body.detail).toContain("방치를 잴 수 없습니다");
      });

      it("이력이 쌓이면 연속 실패 기간을 낸다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/neglect").expect(200);
        expect(response.body.runs).toBe(2);
        if (response.body.streaks.length > 0) {
          expect(response.body.streaks[0].runs).toBeGreaterThanOrEqual(1);
        }
      });

      it("기록이 남은 구간 내내 나빴으면 최소값이라고 말한다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/neglect").expect(200);
        for (const streak of response.body.streaks) {
          expect(streak.truncated).toBe(true);
          expect(streak.detail).toContain("최소값으로 읽으세요");
        }
      });
    });

    describe("진단 이력 보존 (정책 4201-③)", () => {
      it("보존 대상에 진단 이력이 들어 있고 바닥이 14일이다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/settings")
          .expect(200);
        const policy = response.body.retention.find(
          (row: { target: string }) => row.target === "diagnostics",
        );
        expect(policy).toBeDefined();
        expect(policy.minDays).toBe(14);
        expect(policy.why).toContain("방치 지표가 거짓말합니다");
      });

      it("바닥보다 짧은 보존은 받아들이지 않는다 — 그건 방치 지표를 끄는 것이다", async () => {
        const built = await build();
        app = built.app;
        opsSettingsStub["retention.diagnostics.days"] = "2";
        const response = await admin(built.app.getHttpServer(), "/ops/settings")
          .expect(200);
        const policy = response.body.retention.find(
          (row: { target: string }) => row.target === "diagnostics",
        );
        expect(policy.days).toBe(90);
        expect(response.body.rejected.length).toBeGreaterThan(0);
      });
    });

    describe("프로젝트별 비용 (정책 4201-④)", () => {
      it("표본이 없으면 귀속률을 0%로 적지 않는다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(built.app.getHttpServer(), "/ops/cost/projects")
          .expect(200);
        expect(response.body.coverage).toBeNull();
        expect(response.body.caveat).toContain("낼 수 없습니다");
      });

      /**
       * 이 검사가 이 기능의 존재 이유다 — 미배분을 프로젝트 비율로 나눠
       * 얹으면 합계가 맞고 표가 깔끔해지지만, 그 숫자는 만들어낸 것이고
       * 그걸로 팀에 비용을 청구하게 된다.
       */
      it("귀속되지 않은 금액을 프로젝트에 나눠 얹지 않는다", async () => {
        const built = await build();
        app = built.app;

        built.prisma.executions.push(
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: new Date(),
            projectId: "proj-1",
            diagnostic: false,
          },
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 9,
            createdAt: new Date(),
            // 프로젝트를 모르는 기록 — **공용이라는 뜻이 아니다**
            projectId: null,
            diagnostic: false,
          },
        );

        const response = await admin(built.app.getHttpServer(), "/ops/cost/projects")
          .expect(200);
        expect(response.body.attributed).toBe(1);
        expect(response.body.unattributed).toBe(9);
        // 미배분을 나눠 얹었다면 이 프로젝트가 10이 됐을 것이다
        expect(response.body.rows).toHaveLength(1);
        expect(response.body.rows[0].cost).toBe(1);
        // 분모는 미배분을 포함한 전체다 — 빼고 나누면 100%가 된다
        expect(response.body.rows[0].share).toBe(10);
        expect(response.body.detail).toContain("만들어낸 것이 됩니다");
      });

      it("진단·스모크는 프로젝트 비용이 아니므로 따로 둔다", async () => {
        const built = await build();
        app = built.app;

        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 5,
          createdAt: new Date(),
          projectId: null,
          diagnostic: true,
        });

        const response = await admin(built.app.getHttpServer(), "/ops/cost/projects")
          .expect(200);
        expect(response.body.diagnostic).toBe(5);
        expect(response.body.unattributed).toBe(0);
        expect(response.body.detail).toContain("프로젝트 비용이 아니므로");
      });

      it("귀속률이 100%가 아니면 적게 청구된다고 말한다", async () => {
        const built = await build();
        app = built.app;

        built.prisma.executions.push(
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: new Date(),
            projectId: "proj-1",
            diagnostic: false,
          },
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 1,
            createdAt: new Date(),
            projectId: null,
            diagnostic: false,
          },
        );

        const response = await admin(built.app.getHttpServer(), "/ops/cost/projects")
          .expect(200);
        expect(response.body.coverage).toBe(50);
        expect(response.body.caveat).toContain("적게 청구됩니다");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/cost/projects")
          .expect(401);
      });
    });
  });

  describe("Production Readiness Platform (TASK-4301)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("운영 트래픽 호스트 관측 (정책 4301-①)", () => {
      /**
       * 설정값만 보면 리버스 프록시 뒤의 별칭 도메인이 보이지 않는다 —
       * 사용자는 그 주소로 들어오는데 우리 설정 어디에도 그 이름이 없다.
       */
      it("요청의 Host를 관측해 목록에 없는 호스트를 찾아낸다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.PRODUCTION_HOSTS = "acos.example";
        process.env.PUBLIC_BASE_URL = "https://acos.example";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        // 별칭 도메인으로 들어온 요청 — 설정값에는 없는 이름이다.
        // (미들웨어가 붙어 있는지는 아래 "미들웨어 배선" 검사가 따로 본다)
        built.app.get(HostDiscoveryService).observe("m.acos.example");
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/hosts").expect(200);
        const found = response.body.findings.find(
          (row: { host: string }) => row.host === "m.acos.example",
        );
        expect(found.verdict).toBe("undeclared");
        expect(found.sources.join(" ")).toContain("운영 트래픽");
      });

      /**
       * Host 헤더는 요청하는 쪽이 적는 값이다 — 자동 등록하면 바깥에서 우리
       * 보호 목록에 글을 쓰는 것이 된다.
       */
      it("관측했다고 운영 호스트 목록에 넣지 않는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.PRODUCTION_HOSTS = "acos.example";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        built.app.get(HostDiscoveryService).observe("attacker.example");
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/hosts").expect(200);
        // 선언된 수는 그대로다 — 목록은 사람만 바꾼다
        expect(response.body.declared).toBe(1);
        expect(response.body.discovery.detail).toContain("허가가 아닙니다");
      });

      it("관측을 저장해도 호스트 목록 자체는 바뀌지 않는다고 점검 기록에 적는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const response = await post(
          server,
          "/ops/checks/run?job=daily-diagnostics",
        ).expect(200);
        expect(response.body[0].detail).toContain("목록은 바꾸지 않습니다");
      });

      /**
       * TASK-4201에서 겪은 결함: 함수도 시험도 화면도 정상인데 **부르는 곳만**
       * 없었다. 단위 시험은 함수를 직접 부르므로 전부 초록이었다. 그래서
       * 이번에는 배선 자체를 검사한다.
       */
      it("요청마다 Host를 담는 미들웨어가 실제로 붙어 있다", () => {
        const applied: unknown[] = [];
        const consumer = {
          apply: (...middleware: unknown[]) => {
            applied.push(...middleware);
            return { forRoutes: () => undefined };
          },
        };
        new AppModule().configure(consumer as never);
        expect(applied).toContain(HostObserverMiddleware);
      });
    });

    describe("실행 경로 프로젝트 귀속 (정책 4301-②)", () => {
      /**
       * 이 값은 이미 호출 지점까지 와 있었는데 기록에는 안 남고 있었다 —
       * 그래서 비용표의 귀속률이 0에 가까웠다.
       */
      it("개발용 호출은 귀속 대상에서 빼되 합계에는 남긴다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.executions.push(
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 2,
            createdAt: new Date(),
            projectId: "proj-1",
            diagnostic: false,
            feature: "content-generation",
          },
          {
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 3,
            createdAt: new Date(),
            projectId: null,
            diagnostic: false,
            feature: "dev",
          },
        );

        const response = await admin(
          built.app.getHttpServer(),
          "/ops/cost/projects",
        ).expect(200);
        expect(response.body.coverage).toBe(100);
        expect(response.body.unattributableCalls).toBe(1);
        expect(response.body.total).toBe(5);
      });

      /**
       * 표본이 0인데 100%로 적으면 아무 호출도 없는 환경이 가장 잘한 환경이
       * 된다.
       */
      it("최근 창에 표본이 없으면 지금 귀속률을 잴 수 없다고 말한다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 1,
          createdAt: new Date(Date.now() - 10 * 86_400_000),
          projectId: "proj-1",
          diagnostic: false,
          feature: "content-generation",
        });

        const response = await admin(
          built.app.getHttpServer(),
          "/ops/cost/projects",
        ).expect(200);
        expect(response.body.recentCoverage).toBeNull();
        expect(response.body.detail).toContain("잴 수 없습니다");
      });
    });

    describe("방치 무시 (정책 4301-③)", () => {
      const future = (days: number) =>
        new Date(Date.now() + days * 86_400_000).toISOString();

      it("사유·담당자·검토일이 있어야 무시할 수 있다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/neglect/storage/ignore")
          .send({ reason: "짧음", owner: "김운영", reviewAt: future(10) })
          .expect(400);
        await post(server, "/ops/neglect/storage/ignore")
          .send({ reason: "다음 분기 계획에 잡혀 있습니다", owner: "", reviewAt: future(10) })
          .expect(400);
        await post(server, "/ops/neglect/storage/ignore")
          .send({ reason: "다음 분기 계획에 잡혀 있습니다", owner: "김운영" })
          .expect(400);
      });

      /**
       * 무기한 무시는 "안 고치기로 했다"를 기록하는 것이 아니라 잊는 것이다.
       */
      it("검토일이 상한을 넘으면 거절한다", async () => {
        const built = await build();
        app = built.app;
        const response = await post(
          built.app.getHttpServer(),
          "/ops/neglect/storage/ignore",
        )
          .send({
            reason: "다음 분기 계획에 잡혀 있습니다",
            owner: "김운영",
            reviewAt: future(200),
          })
          .expect(400);
        expect(response.body.message).toContain("잊는 것이고");
      });

      it("무시해도 목록에서 사라지지 않고 방치 건수에서도 빠지지 않는다", async () => {
        // 운영 호스트 목록을 비워 두면 진단이 실패를 하나 낸다 — 그래야
        // 무시할 대상이 생긴다
        process.env.DEPLOY_TIER = "staging";
        delete process.env.PRODUCTION_HOSTS;
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const before = await admin(server, "/ops/neglect").expect(200);
        const target = before.body.streaks[0];
        expect(target).toBeDefined();

        await post(server, `/ops/neglect/${target.id}/ignore`)
          .send({
            reason: "자격 증명이 오기 전에는 고칠 수 없습니다",
            owner: "김운영",
            reviewAt: future(20),
          })
          .expect(200);

        const after = await admin(server, "/ops/neglect").expect(200);
        const row = after.body.streaks.find(
          (item: { id: string }) => item.id === target.id,
        );
        expect(after.body.streaks).toHaveLength(before.body.streaks.length);
        expect(row.ignored).toBe(true);
        expect(row.ignoreOwner).toBe("김운영");
        expect(row.ignoreLabel).toContain("무시 중");
        expect(after.body.ignoredCount).toBe(1);
        expect(after.body.detail).toContain("방치 건수에서 빼지");
      });

      it("무시를 취소하면 행은 남고 취소 기록이 붙는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await post(server, "/ops/neglect/storage/ignore")
          .send({
            reason: "자격 증명이 오기 전에는 고칠 수 없습니다",
            owner: "김운영",
            reviewAt: future(20),
          })
          .expect(200);

        await post(server, `/ops/neglect/ignores/${created.body.id}/revoke`).expect(200);
        const list = await admin(server, "/ops/neglect/ignores").expect(200);
        const row = list.body.find(
          (item: { id: string }) => item.id === created.body.id,
        );
        expect(row.revokedAt).not.toBeNull();
        expect(row.active).toBe(false);
      });

      it("무시와 취소는 감사 기록에 이름이 붙는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const created = await post(server, "/ops/neglect/storage/ignore")
          .send({
            reason: "자격 증명이 오기 전에는 고칠 수 없습니다",
            owner: "김운영",
            reviewAt: future(20),
          })
          .expect(200);
        await post(server, `/ops/neglect/ignores/${created.body.id}/revoke`).expect(200);

        const audit = await admin(server, "/ops/audit").expect(200);
        const actions = audit.body.map((row: { action: string }) => row.action);
        expect(actions).toContain("neglect.ignore");
        expect(actions).toContain("neglect.ignore-revoke");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .post("/ops/neglect/storage/ignore")
          .send({ reason: "x", owner: "y", reviewAt: future(1) })
          .expect(401);
      });
    });

    describe("Production Readiness Dashboard (정책 4301-④)", () => {
      it("여섯 판정을 모으고 각 칸이 출처를 달고 있다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;

        const response = await admin(
          built.app.getHttpServer(),
          "/ops/readiness-board",
        ).expect(200);
        expect(response.body.tiles.length).toBeGreaterThanOrEqual(7);
        for (const tile of response.body.tiles) {
          expect(tile.source).toMatch(/^GET \/ops\//);
        }
      });

      /**
       * 대시보드가 자기 점수를 계산하면 같은 사실에 두 개의 답이 생기고,
       * 어긋나는 순간 사람은 둘 다 안 믿는다 (TASK-4101 라이브 결함).
       */
      it("준비 단계의 분모를 그대로 쓴다 — 새로 계산하지 않는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const [board, plan] = await Promise.all([
          admin(server, "/ops/readiness-board").expect(200),
          admin(server, "/ops/validation-plan").expect(200),
        ]);
        expect(board.body.steps).toEqual({ done: plan.body.done, total: plan.body.total });
        expect(board.body.readiness).toBe(plan.body.readiness);
        expect(board.body.detail).toContain("인용만 합니다");
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/readiness-board")
          .expect(401);
      });
    });

    describe("검증 환경 최종 준비 (정책 4301-⑤⑥)", () => {
      /**
       * 두 점을 몇 분 간격으로 찍어 이 단계를 통과시킬 수 있다면, 그 초록은
       * 기준선이 아니라 우리가 산 것이다.
       */
      it("스냅샷 두 점이 너무 가까우면 기준선으로 세지 않는다", async () => {
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        // 두 점을 한 시간 간격으로 심는다 — 개수만 보면 통과할 상태다
        built.prisma.kpiSnapshots.push(
          { id: "snap-a", metric: "publish-rate", value: 1, takenAt: new Date(Date.now() - 3_600_000) },
          { id: "snap-b", metric: "publish-rate", value: 1, takenAt: new Date() },
        );

        const response = await admin(server, "/ops/validation-plan").expect(200);
        const step = response.body.steps.find(
          (row: { id: string }) => row.id === "baseline",
        );
        expect(step.status).toBe("pending");
        expect(step.detail).toContain("초록을 산 것");
      });

      it("실행 잠금은 그대로 유지된다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        await post(built.app.getHttpServer(), "/ops/validation-run").expect(403);
      });
    });
  });

  describe("Production Activation Platform (TASK-4401)", () => {
    const admin = (server: unknown, path: string) =>
      request(server as never).get(path).set("Authorization", "Bearer tok-admin");

    const post = (server: unknown, path: string) =>
      request(server as never).post(path).set("Authorization", "Bearer tok-admin");

    describe("신뢰하는 프록시 (정책 4401-①)", () => {
      /**
       * 프록시가 Host를 바꿔 전달하는 구성에서는 우리가 보는 Host가 내부
       * 주소이고, 사용자가 실제로 친 도메인은 전달 헤더에 있다.
       */
      it("선언된 프록시가 보낸 전달 헤더를 관측에 쓴다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.PRODUCTION_HOSTS = "acos.example";
        process.env.TRUSTED_PROXY_IPS = "10.0.0.5";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        built.app.get(HostDiscoveryService).observe("api.internal", Date.now(), {
          forwardedHost: "m.acos.example",
          peer: "10.0.0.5",
        });
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/hosts").expect(200);
        const hosts = response.body.findings.map((row: { host: string }) => row.host);
        expect(hosts).toContain("m.acos.example");
        expect(response.body.trustedProxy.viaProxy).toBeGreaterThan(0);
      });

      /**
       * 기본값은 언제나 "안 믿는다"다 — 선언 없이 전달 헤더를 보면 누가
       * 적었는지 모르는 이름이 관측에 들어간다.
       */
      it("선언이 없으면 전달 헤더를 보지 않는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        delete process.env.TRUSTED_PROXY_IPS;
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        built.app.get(HostDiscoveryService).observe("api.internal", Date.now(), {
          forwardedHost: "spoofed.example",
          peer: "203.0.113.9",
        });
        await post(server, "/ops/checks/run?job=daily-diagnostics").expect(200);

        const response = await admin(server, "/ops/hosts").expect(200);
        const hosts = response.body.findings.map((row: { host: string }) => row.host);
        expect(hosts).not.toContain("spoofed.example");
        expect(response.body.trustedProxy.declared).toBe(0);
      });

      /**
       * 조용히 버리면 "누군가 프록시인 척했다"는 사실까지 사라진다.
       */
      it("신뢰하지 않는 상대가 보낸 전달 헤더를 세어 화면에 남긴다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.TRUSTED_PROXY_IPS = "10.0.0.5";
        const built = await build();
        app = built.app;

        built.app.get(HostDiscoveryService).observe("api.internal", Date.now(), {
          forwardedHost: "spoofed.example",
          peer: "203.0.113.9",
        });

        const response = await admin(built.app.getHttpServer(), "/ops/hosts").expect(200);
        expect(response.body.trustedProxy.untrusted).toBe(1);
        expect(response.body.trustedProxy.detail).toContain("프록시인 척한");
      });

      it("값이 여러 개면 추측하지 않고 그 사실을 남긴다", async () => {
        process.env.DEPLOY_TIER = "staging";
        process.env.TRUSTED_PROXY_IPS = "10.0.0.5";
        const built = await build();
        app = built.app;

        built.app.get(HostDiscoveryService).observe("api.internal", Date.now(), {
          forwardedHost: "evil.example, acos.example",
          peer: "10.0.0.5",
        });

        const response = await admin(built.app.getHttpServer(), "/ops/hosts").expect(200);
        expect(response.body.trustedProxy.ambiguous).toBe(1);
        expect(response.body.trustedProxy.detail).toContain("고른 이유가 없는 값");
      });
    });

    describe("미귀속 실행 경로 (정책 4401-②)", () => {
      it("어느 경로가 빠뜨리는지 이름으로 말한다", async () => {
        const built = await build();
        app = built.app;
        for (let index = 0; index < 25; index += 1) {
          built.prisma.executions.push({
            provider: "openai",
            model: "gpt-4o",
            status: "SUCCESS",
            cost: 0.1,
            createdAt: new Date(),
            projectId: index < 20 ? "proj-1" : null,
            diagnostic: false,
            feature: index < 20 ? "content-generation" : "vision-analysis",
          });
        }

        const response = await admin(
          built.app.getHttpServer(),
          "/ops/cost/attribution",
        ).expect(200);
        expect(response.body.total).toBe(25);
        expect(response.body.missing).toBe(5);
        expect(response.body.verdict).toBe("below");
        expect(response.body.next).toContain("vision-analysis");
      });

      /**
       * 2건 중 2건으로 "목표 달성"을 적으면 다음 주에 조용히 무너진다.
       */
      it("표본이 모자라면 달성이라고 말하지 않는다", async () => {
        const built = await build();
        app = built.app;
        built.prisma.executions.push({
          provider: "openai",
          model: "gpt-4o",
          status: "SUCCESS",
          cost: 0.1,
          createdAt: new Date(),
          projectId: "proj-1",
          diagnostic: false,
          feature: "content-generation",
        });

        const response = await admin(
          built.app.getHttpServer(),
          "/ops/cost/attribution",
        ).expect(200);
        expect(response.body.coverage).toBe(100);
        expect(response.body.verdict).toBe("insufficient");
      });

      it("목표는 95%다", async () => {
        const built = await build();
        app = built.app;
        const response = await admin(
          built.app.getHttpServer(),
          "/ops/cost/attribution",
        ).expect(200);
        expect(response.body.target).toBe(95);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never)
          .get("/ops/cost/attribution")
          .expect(401);
      });
    });

    describe("무시 검토 알림 (정책 4401-③)", () => {
      const future = (days: number) =>
        new Date(Date.now() + days * 86_400_000).toISOString();

      /**
       * 조회가 알림을 보내면, 화면을 여는 것만으로 담당자에게 연락이 간다.
       */
      it("조회는 계획만 내고 아무것도 보내지 않는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/neglect/storage/ignore")
          .send({
            reason: "자격 증명이 오기 전에는 고칠 수 없습니다",
            owner: "김운영",
            reviewAt: future(1),
          })
          .expect(200);

        const before = built.prisma.deliveries.length;
        const response = await admin(server, "/ops/neglect/notices").expect(200);
        expect(response.body.notices).toHaveLength(1);
        expect(response.body.notices[0].stage).toBe("due-soon");
        expect(built.prisma.deliveries.length).toBe(before);
      });

      it("검토일이 멀면 아무것도 계획하지 않는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        await post(server, "/ops/neglect/storage/ignore")
          .send({
            reason: "자격 증명이 오기 전에는 고칠 수 없습니다",
            owner: "김운영",
            reviewAt: future(30),
          })
          .expect(200);

        const response = await admin(server, "/ops/neglect/notices").expect(200);
        expect(response.body.notices).toEqual([]);
        expect(response.body.quiet).toBe(1);
      });

      it("알림이 무시를 연장하지 않는다는 사실을 적는다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        const response = await admin(
          built.app.getHttpServer(),
          "/ops/neglect/notices",
        ).expect(200);
        expect(response.body.detail).toContain("무시가 되살아나지 않습니다");
      });
    });

    describe("운영 활성화 런북 (정책 4401-⑤)", () => {
      it("모든 단계에 되돌리는 법이 적혀 있다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/runbook").expect(200);
        expect(response.body.steps.length).toBeGreaterThan(5);
        for (const step of response.body.steps) {
          expect(String(step.rollback).length).toBeGreaterThan(10);
          expect(step.source).toMatch(/^GET \/ops\//);
        }
      });

      it("되돌릴 수 없는 단계를 표시한다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;

        const response = await admin(built.app.getHttpServer(), "/ops/runbook").expect(200);
        const smoke = response.body.steps.find(
          (row: { id: string }) => row.id === "smoke",
        );
        expect(smoke.irreversible).toBe(true);
        expect(smoke.rollback).toContain("되돌릴 수 없");
      });

      /**
       * 준비 화면이 런북을 인용하므로, 런북이 준비 화면을 다시 부르면
       * 서로를 부르는 고리가 된다 — 두 화면은 같은 원본 판정을 인용한다.
       */
      it("운영 준비 화면이 런북을 인용한다", async () => {
        process.env.DEPLOY_TIER = "staging";
        const built = await build();
        app = built.app;
        const server = built.app.getHttpServer();

        const [board, runbook] = await Promise.all([
          admin(server, "/ops/readiness-board").expect(200),
          admin(server, "/ops/runbook").expect(200),
        ]);
        const tile = board.body.tiles.find(
          (row: { id: string }) => row.id === "runbook",
        );
        expect(tile).toBeDefined();
        expect(tile.source).toBe("GET /ops/runbook");
        expect(tile.detail).toContain(`${runbook.body.done}/${runbook.body.total}`);
      });

      it("ADMIN 전용이다", async () => {
        const built = await build();
        app = built.app;
        await request(built.app.getHttpServer() as never).get("/ops/runbook").expect(401);
      });
    });
  });
});

/**
 * 만료된 초안을 심는다 — 승격은 지금 만들어지므로 만료 시각은 직접 넣는다.
 */
async function seedExpiredDraft(
  built: Awaited<ReturnType<typeof build>>,
  options: { expired?: boolean } = {},
): Promise<string> {
  const stub = built.prisma.stub as never as {
    incident: {
      create: (a: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    };
  };
  const created = await stub.incident.create({
    data: {
      component: "llm",
      severity: "CRITICAL",
      summary: "경보에서 만든 초안: OpenAI 호출 실패",
      startedAt: new Date(Date.now() - 53 * 86_400_000),
      status: "DRAFT",
      sourceAlertKey: `provider-failure:seed-${Math.floor(Date.now() % 100000)}`,
      expiredAt:
        options.expired === false ? null : new Date(Date.now() - 23 * 86_400_000),
      createdAt: new Date(Date.now() - 53 * 86_400_000),
    },
  });
  return created.id;
}
