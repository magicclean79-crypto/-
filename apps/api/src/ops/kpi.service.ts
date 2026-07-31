import { Injectable, Logger } from "@nestjs/common";
import {
  isSchedulerStopped,
  resolveKpiThresholds,
  resolveSchedules,
  summarizeIncidents,
  summarizeOperationsKpi,
} from "@acos/core";
import type { IncidentComponent, IncidentRecord, IncidentSeverity } from "@acos/core";
import type { OperationsKpiDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ActivationHistoryService } from "./activation-history.service";
import { CiStatusService } from "./ci-status.service";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { ProductionCutoverService } from "./production-cutover.service";

/** 관측 창 — 지표는 창을 밝히지 않으면 아무 뜻이 없다 */
export const KPI_WINDOW_DAYS = 30;

/**
 * 운영 KPI. (TASK-3801, Sprint 38 — CTO 정책 3801-③)
 *
 * 판정은 전부 `@acos/core`가 하고, 여기서는 **모아 오기만** 합니다.
 * 가져오지 못한 것은 "없음"이 아니라 그대로 비워 넘깁니다 — 못 본 것을
 * 통과로 바꾸지 않는다는 규칙이 여기서도 같습니다.
 */
@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly history: ActivationHistoryService,
    private readonly cutover: ProductionCutoverService,
    private readonly ci: CiStatusService,
    // 임계값은 운영 설정이다 (TASK-3901, CTO 정책 3901-②)
    private readonly settings: AdminSettingsService,
  ) {}

  async report(branch?: string): Promise<OperationsKpiDto> {
    const now = Date.now();
    const since = new Date(now - KPI_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [history, activation, smokeRows, incidentRows, alerts, raised, checks, ciRuns] =
      await Promise.all([
        this.history.history(200),
        this.cutover.activation(branch),
        this.prisma.smokeRun.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.incident.findMany({ orderBy: { startedAt: "desc" }, take: 200 }),
        this.prisma.alert.count({ where: { status: "ACTIVE" } }),
        this.prisma.alert.count({ where: { firstRaisedAt: { gte: since } } }),
        this.prisma.checkRun.findMany({
          where: { createdAt: { gte: since } },
          select: { ok: true },
        }),
        this.ci.runs(branch).catch(() => null),
      ]);

    // 임계값을 먼저 해석한다 — 잘못된 설정은 기본값으로 되돌아가되
    // 그 사실이 `rejected`에 남는다 (조용히 버리지 않는다)
    const resolved = resolveKpiThresholds(this.settings.all());
    const thresholds = resolved.thresholds;
    if (resolved.rejected.length > 0) {
      this.logger.warn(
        `받아들이지 않은 KPI 임계값 ${resolved.rejected.length}건: ` +
          resolved.rejected.map((row) => `${row.key}(${row.reason})`).join(" · "),
      );
    }

    // **확인된 장애만 센다** (TASK-3901, 정책 3901-⑤) — 초안은 아직 사람이
    // 장애라고 말한 적이 없고, 기각된 것은 장애가 아니었다. 초안을 MTTR에
    // 넣으면 자동 승격을 켜는 순간 지표가 흔들린다.
    const incidents = summarizeIncidents(
      incidentRows.filter((row) => row.status === "CONFIRMED").map(toIncidentRecord),
      new Date(now),
    );

    // 감시가 돌고 있는가 — 멈춰 있으면 "경보 0건"은 조용함이 아니다.
    // 예약이 꺼져 있어도 "멈춘 것"은 아니지만(결정 1401-①), KPI에서는
    // **보고 있지 않다**는 사실이 같으므로 둘 다 unknown으로 넘긴다.
    const enabled = resolveSchedules(process.env as Record<string, string | undefined>)
      .filter((schedule) => schedule.enabled);
    const lastCheck = await this.prisma.checkRun
      .findFirst({ orderBy: { createdAt: "desc" } })
      .catch(() => null);
    const schedulerRunning =
      enabled.length > 0 &&
      !enabled.some((schedule) =>
        isSchedulerStopped(schedule, lastCheck?.createdAt.getTime() ?? null, now, {
          graceFactor: 4,
          startedAt: now,
        }),
      );

    const report = summarizeOperationsKpi({
      windowDays: KPI_WINDOW_DAYS,
      activation: {
        activated: history.activated,
        met: activation.conditions.filter((condition) => condition.met).length,
        total: activation.conditions.length,
        applicable: activation.applicable,
        heldMs: history.timeline[0]?.heldMs ?? null,
        regressions: history.regressions,
      },
      smoke: {
        results: smokeRows.map((row) => ({ status: row.status })),
        ranAt: smokeRows[0]?.createdAt.getTime() ?? null,
      },
      incidents: {
        open: incidents.open.length,
        resolved: incidents.resolvedCount,
        mttrMs: incidents.mttrMs,
        mttdMs: incidents.mttdMs,
        awaitingPermanentFix: incidents.awaitingPermanentFix.length,
      },
      alerts: { active: alerts, raised, schedulerRunning },
      checks: {
        total: checks.length,
        ok: checks.filter((row) => row.ok).length,
      },
      // CI 이력을 못 읽었으면 0/0으로 넘긴다 — 판정이 "낼 수 없음"이라고 말한다
      ci: { total: ciRuns?.total ?? 0, success: ciRuns?.passed ?? 0 },
      now,
      thresholds,
    });

    return {
      kpis: report.kpis,
      windowDays: report.windowDays,
      unknown: report.unknown,
      bad: report.bad,
      adjusted: report.adjusted,
      relaxed: report.relaxed,
      rejected: resolved.rejected,
      detail: report.detail,
      checkedAt: report.checkedAt,
    };
  }
}

function toIncidentRecord(row: {
  id: string;
  component: string;
  severity: string;
  summary: string;
  startedAt: Date;
  detectedAt: Date | null;
  resolvedAt: Date | null;
  cause: string | null;
  recovery: string | null;
  fixKind: string | null;
  rootCause: string | null;
  temporaryFix: string | null;
  permanentFix: string | null;
  prevention: string | null;
  status: string;
  sourceAlertKey: string | null;
  dismissedAt: Date | null;
  dismissReason: string | null;
}): IncidentRecord {
  return {
    id: row.id,
    component: row.component as IncidentComponent,
    severity: row.severity as IncidentSeverity,
    summary: row.summary,
    startedAt: row.startedAt,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    cause: row.cause,
    recovery: row.recovery,
    fixKind: row.fixKind as IncidentRecord["fixKind"],
    rootCause: row.rootCause,
    temporaryFix: row.temporaryFix,
    permanentFix: row.permanentFix,
    prevention: row.prevention,
    status: row.status as IncidentRecord["status"],
    sourceAlertKey: row.sourceAlertKey,
    dismissedAt: row.dismissedAt,
    dismissReason: row.dismissReason,
  };
}
