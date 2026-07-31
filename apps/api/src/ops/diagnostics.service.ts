import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import {
  PRODUCTION_HOSTS_ENV,
  VALIDATION_TARGET_ACK_ENV,
  VALIDATION_TARGET_ENV,
  compareDiagnostics,
  detectDiagnosticAlerts,
  hostOf,
  parseHostList,
  verifyProductionHosts,
  detectRegressionAlerts,
  judgeValidationTarget,
  resolveDeploymentTier,
  resolveSchedules,
  runDiagnostics,
  tierPolicy,
  validateEnvironment,
} from "@acos/core";
import type {
  DeploymentTier,
  DetectedAlert,
  DiagnosticRunRecord,
  DiagnosticStage,
  HostVerificationReport,
  ObservedHost,
  ValidationTargetJudgement,
} from "@acos/core";
import type {
  DiagnosticComparisonDto,
  DiagnosticReportDto,
  DiagnosticRunDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { MigrationGovernanceService } from "./migration-governance.service";
import { NotificationService } from "./notification.service";
import { ProductionCutoverService } from "./production-cutover.service";

/**
 * 기동·일일 운영 진단. (TASK-4001, Sprint 40 — CTO 정책 4001-④⑤)
 *
 * 우리에겐 판정이 많지만 전부 **누군가 부를 때만** 돕니다. 그래서 배포
 * 직후와 매일 아침이라는 두 순간이 비어 있었습니다.
 *
 * **기동을 막지 않습니다.** 진단이 빨간색이어도 서버는 뜹니다 — 경보와
 * 차단은 다릅니다. 다만 조용하지도 않습니다: 로그에 남고, 운영이면
 * 경보가 납니다.
 *
 * 판정은 전부 `@acos/core`가 합니다.
 */
@Injectable()
export class DiagnosticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiagnosticsService.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly migrations: MigrationGovernanceService,
    private readonly cutover: ProductionCutoverService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * 기동 직후 진단 (CTO 정책 4001-⑤).
   *
   * 실패해도 예외를 던지지 않습니다 — **진단이 서비스를 못 뜨게 하면
   * 그것이 더 큰 사고입니다.**
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === "test" || process.env.OPS_STARTUP_DIAGNOSTICS === "off") {
      return;
    }
    try {
      const report = await this.run("startup", Date.now(), { persist: true });
      const line = `기동 진단: ${report.detail}`;
      if (report.fail > 0) {
        this.logger.error(line);
      } else if (report.warn > 0 || report.unknown > 0) {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    } catch (error) {
      // 진단이 못 돌았다는 것도 사실이다 — 조용히 넘기지 않는다
      this.logger.error(`기동 진단을 돌리지 못했습니다: ${String(error)}`);
    }
  }

  /** 지금 이 인스턴스의 배포 단계 (CTO 정책 4101-③) */
  tier(): DeploymentTier {
    return resolveDeploymentTier(process.env as Record<string, string | undefined>);
  }

  /**
   * 운영 호스트 목록 검증 (CTO 정책 4201-①).
   *
   * 관측은 **설정값에서** 모읍니다 — 실행 기록의 `baseUrl`까지 넣으면
   * Provider 도메인(api.openai.com 등)이 "운영 호스트 후보"로 올라오는데,
   * 그건 우리 운영 도메인이 아니라 남의 서비스 주소입니다. 그것을 목록에
   * 넣으라고 권하면 검증 대상 보호가 엉뚱한 것을 막게 됩니다.
   */
  hosts(): HostVerificationReport {
    const env = process.env as Record<string, string | undefined>;
    const observed: ObservedHost[] = [];
    const add = (raw: string | undefined, source: string): void => {
      const host = hostOf(raw);
      if (host !== null) {
        observed.push({ host, source, fromTraffic: false });
      }
    };
    add(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
    add(env.NEXT_PUBLIC_API_URL, "NEXT_PUBLIC_API_URL");
    add(env.S3_PUBLIC_URL, "S3_PUBLIC_URL");

    return verifyProductionHosts({
      declared: parseHostList(env.PRODUCTION_HOSTS),
      observed,
      tier: this.tier(),
    });
  }

  /** 검증 대상 판정 (CTO 정책 4101-①) */
  validationTarget(): ValidationTargetJudgement {
    const env = process.env as Record<string, string | undefined>;
    return judgeValidationTarget({
      raw: env[VALIDATION_TARGET_ENV],
      ack: env[VALIDATION_TARGET_ACK_ENV],
      productionHosts: env[PRODUCTION_HOSTS_ENV],
      selfUrl: env.PUBLIC_BASE_URL ?? null,
      tier: this.tier(),
    });
  }

  /**
   * 진단을 돌린다.
   *
   * `persist: true`면 결과를 남기고 **지난 실행과 비교합니다**
   * (CTO 정책 4101-②). 화면을 열 때마다 남기면 이력이 조회 기록으로
   * 뒤덮여 "어제와 오늘"을 찾을 수 없으므로, 남기는 것은 예약 점검과
   * 기동 진단만 합니다.
   */
  async run(
    stage: DiagnosticStage,
    now = Date.now(),
    options: { persist?: boolean } = {},
  ): Promise<DiagnosticReportDto> {
    const env = process.env as Record<string, string | undefined>;
    const tier = this.tier();

    const [database, storage, pendingMigrations, activation] = await Promise.all([
      this.reachable(() => this.prisma.$queryRaw`SELECT 1`),
      this.reachable(() => this.storage.check()),
      this.pendingMigrations(tierPolicy(tier).requiresOperationalConfig),
      this.activation(),
    ]);

    const scheduledChecksEnabled = resolveSchedules(env).some(
      (schedule) => schedule.enabled,
    );

    const report = runDiagnostics({
      stage,
      tier,
      tierDeclared: (env.DEPLOY_TIER ?? "").trim().length > 0,
      // 검증 대상은 **검증을 준비하는 단계에서만** 봅니다 — 개발자 노트북에
      // 이 값을 두라고 요구하면 그 경고가 배경 소음이 됩니다
      validationTarget: tierPolicy(tier).requiresOperationalConfig
        ? {
            raw: env[VALIDATION_TARGET_ENV],
            ack: env[VALIDATION_TARGET_ACK_ENV],
            productionHosts: env[PRODUCTION_HOSTS_ENV],
            selfUrl: env.PUBLIC_BASE_URL ?? null,
          }
        : null,
      // 운영 호스트 목록 (정책 4201-①) — 검증 대상 보호가 대조할 것이
      // 정확한지 본다. 개발에서는 요구하지 않으므로 판정도 그때만 붙인다.
      hosts: tierPolicy(tier).requiresOperationalConfig
        ? {
            declared: parseHostList(env.PRODUCTION_HOSTS),
            observed: this.hosts().findings
              .filter((row) => row.verdict !== "unseen")
              .flatMap((row) =>
                row.sources.map((source) => ({
                  host: row.host,
                  source,
                  fromTraffic: false,
                })),
              ),
          }
        : null,
      env,
      envErrors: validateEnvironment(env).errors.map((issue) => ({
        name: issue.name,
        message: issue.message,
      })),
      database,
      storage,
      pendingMigrations,
      scheduledChecksEnabled,
      // 채널이 설정됐는지 판단하는 규칙은 이미 NotificationService에 있다 —
      // 여기서 다시 쓰면 두 곳이 서로 다른 답을 내는 날이 온다
      anyChannelConfigured: this.notifications
        .channelConfigs()
        .some((config) => config.enabled),
      activation,
      uptimeMs: now - this.startedAt,
      now,
    });

    // 지난 실행과 비교한다 (정책 4101-②) — **같은 단계·같은 배포 단계끼리만**
    const previous = await this.previousRun(tier, stage);
    const current: DiagnosticRunRecord = {
      id: "current",
      stage,
      tier,
      ranAt: now,
      checks: report.checks.map((check) => ({
        id: check.id,
        title: check.title,
        status: check.status,
      })),
      ok: report.ok,
      warn: report.warn,
      fail: report.fail,
      unknown: report.unknown,
    };
    const comparison = compareDiagnostics(previous, current);

    if (options.persist === true) {
      await this.persist(current, report.detail);
    }

    return {
      stage: report.stage,
      checks: report.checks,
      ok: report.ok,
      warn: report.warn,
      fail: report.fail,
      unknown: report.unknown,
      blocked: false,
      tier,
      comparison: toComparisonDto(comparison),
      detail: report.detail,
      ranAt: report.ranAt,
    };
  }

  /** 저장된 진단 이력 (CTO 정책 4101-②) */
  async history(limit = 30, tier?: string): Promise<DiagnosticRunDto[]> {
    const rows = await this.prisma.diagnosticRun.findMany({
      where: tier === undefined ? {} : { tier },
      orderBy: { ranAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      stage: row.stage,
      tier: row.tier,
      ok: row.ok,
      warn: row.warn,
      fail: row.fail,
      unknown: row.unknown,
      detail: row.detail,
      ranAt: row.ranAt.toISOString(),
    }));
  }

  /**
   * 같은 단계·같은 배포 단계의 직전 실행.
   *
   * **섞어서 비교하지 않습니다** — 기동 진단과 일일 진단은 항목 구성이
   * 다르고(기동에만 관측 이력 항목이 있습니다), 스테이징과 운영은 판정
   * 기준이 다릅니다. 섞으면 "어제 정상이던 것이 오늘 실패"가 사실은 다른
   * 환경의 이야기가 됩니다.
   */
  private async previousRun(
    tier: DeploymentTier,
    stage: DiagnosticStage,
  ): Promise<DiagnosticRunRecord | null> {
    try {
      const row = await this.prisma.diagnosticRun.findFirst({
        where: { tier, stage },
        orderBy: { ranAt: "desc" },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        stage: row.stage,
        tier: row.tier,
        ranAt: row.ranAt.getTime(),
        checks: row.checks as DiagnosticRunRecord["checks"],
        ok: row.ok,
        warn: row.warn,
        fail: row.fail,
        unknown: row.unknown,
      };
    } catch (error) {
      // 이력을 못 읽은 것은 "변화가 없다"가 아니다 — 비교를 포기하고 그렇게 말한다
      this.logger.warn(`진단 이력을 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  private async persist(record: DiagnosticRunRecord, detail: string): Promise<void> {
    try {
      await this.prisma.diagnosticRun.create({
        data: {
          stage: record.stage,
          tier: record.tier,
          ok: record.ok,
          warn: record.warn,
          fail: record.fail,
          unknown: record.unknown,
          checks: record.checks,
          detail,
          ranAt: new Date(record.ranAt),
        },
      });
    } catch (error) {
      // 기록 실패가 진단을 막지 않는다 — 다만 조용하지도 않다
      this.logger.warn(`진단 이력을 남기지 못했습니다: ${String(error)}`);
    }
  }

  /**
   * 진단 결과를 경보로 — 보내는 것은 AlertService가 한다.
   *
   * 두 종류를 냅니다: **지금 나쁜 것**(정책 4001-⑤)과 **지난 진단 이후
   * 나빠진 것**(정책 4101-②). 후자가 훨씬 행동을 만드는 소식입니다 —
   * 어제 무언가를 바꿨다는 뜻이고 지금이라면 무엇을 바꿨는지 기억할 수
   * 있으니까요.
   */
  async detect(stage: DiagnosticStage, now = Date.now()): Promise<{
    report: DiagnosticReportDto;
    alerts: DetectedAlert[];
  }> {
    const report = await this.run(stage, now, { persist: true });
    const tier = this.tier();
    const policy = tierPolicy(tier);

    const alerts = detectDiagnosticAlerts(
      {
        stage: report.stage as DiagnosticStage,
        checks: report.checks as never,
        ok: report.ok,
        warn: report.warn,
        fail: report.fail,
        unknown: report.unknown,
        blocked: false,
        detail: report.detail,
        ranAt: report.ranAt,
      },
      tier,
    ) as DetectedAlert[];

    const regressions =
      report.comparison === null
        ? []
        : (detectRegressionAlerts(
            {
              regressed: report.comparison.regressed as never,
              recovered: report.comparison.recovered as never,
              persisting: report.comparison.persisting as never,
              disappeared: report.comparison.disappeared as never,
              appeared: report.comparison.appeared as never,
              comparable: report.comparison.comparable,
              comparedTo: null,
              detail: report.comparison.detail,
            },
            { tier, stage, alerting: policy.alerting },
          ) as DetectedAlert[]);

    return { report, alerts: [...alerts, ...regressions] };
  }

  /** 닿는가 — **못 본 것은 `null`이다**(닿는다가 아니다) */
  private async reachable(probe: () => Promise<unknown>): Promise<boolean | null> {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  }

  private async pendingMigrations(production: boolean): Promise<number | null> {
    try {
      const judged = await this.migrations.judge(production);
      // 판정이 `manual`이면 디렉터리나 적용 기록을 읽지 못한 것이다 —
      // 그때의 `pending: []`는 "0건"이 아니라 "모른다"다
      return judged.status === "manual" ? null : judged.pending.length;
    } catch (error) {
      this.logger.warn(`마이그레이션 적용 상태를 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  private async activation(): Promise<{
    met: number;
    total: number;
    applicable: boolean;
  } | null> {
    try {
      const report = await this.cutover.activation();
      return {
        met: report.conditions.filter((condition) => condition.met).length,
        total: report.conditions.length,
        applicable: report.applicable,
      };
    } catch (error) {
      this.logger.warn(`활성화 상태를 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }
}

/** core 판정을 DTO로 (값을 바꾸지 않는다) */
function toComparisonDto(
  comparison: ReturnType<typeof compareDiagnostics>,
): DiagnosticComparisonDto {
  const map = (rows: { id: string; title: string; from: string | null; to: string | null }[]) =>
    rows.map((row) => ({ id: row.id, title: row.title, from: row.from, to: row.to }));
  return {
    regressed: map(comparison.regressed),
    recovered: map(comparison.recovered),
    persisting: map(comparison.persisting),
    disappeared: map(comparison.disappeared),
    appeared: map(comparison.appeared),
    comparable: comparison.comparable,
    comparedTo:
      comparison.comparedTo === null
        ? null
        : new Date(comparison.comparedTo).toISOString(),
    detail: comparison.detail,
  };
}
