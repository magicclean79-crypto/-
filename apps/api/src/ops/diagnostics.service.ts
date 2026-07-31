import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import {
  detectDiagnosticAlerts,
  resolveSchedules,
  runDiagnostics,
  validateEnvironment,
} from "@acos/core";
import type { DetectedAlert, DiagnosticStage } from "@acos/core";
import type { DiagnosticReportDto } from "@acos/shared";
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
      const report = await this.run("startup");
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

  /** 진단을 돌린다 — 아무것도 바꾸지 않는다 */
  async run(stage: DiagnosticStage, now = Date.now()): Promise<DiagnosticReportDto> {
    const env = process.env as Record<string, string | undefined>;
    const production = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";

    const [database, storage, pendingMigrations, activation] = await Promise.all([
      this.reachable(() => this.prisma.$queryRaw`SELECT 1`),
      this.reachable(() => this.storage.check()),
      this.pendingMigrations(production),
      this.activation(),
    ]);

    const scheduledChecksEnabled = resolveSchedules(env).some(
      (schedule) => schedule.enabled,
    );

    const report = runDiagnostics({
      stage,
      production,
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

    return {
      stage: report.stage,
      checks: report.checks,
      ok: report.ok,
      warn: report.warn,
      fail: report.fail,
      unknown: report.unknown,
      blocked: false,
      detail: report.detail,
      ranAt: report.ranAt,
    };
  }

  /** 진단 결과를 경보로 (운영에서만) — 보내는 것은 AlertService가 한다 */
  async detect(stage: DiagnosticStage, now = Date.now()): Promise<{
    report: DiagnosticReportDto;
    alerts: DetectedAlert[];
  }> {
    const report = await this.run(stage, now);
    const production = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
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
      production,
    ) as DetectedAlert[];
    return { report, alerts };
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
