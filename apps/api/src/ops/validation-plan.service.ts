import { Injectable, Logger } from "@nestjs/common";
import { VALIDATION_STEPS, judgeValidationPlan } from "@acos/core";
import type { ValidationPlanDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { DiagnosticsService } from "./diagnostics.service";
import { NotificationService } from "./notification.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProductionSmokeService } from "./production-smoke.service";

/**
 * Production Validation Sprint 준비. (TASK-4001, Sprint 40 — CTO 정책 4001-⑥)
 *
 * "준비 완료"를 스스로 선언하지 않습니다. 남은 것은 자격 증명·나가는
 * 길·검증용 환경이고 셋 다 **사람이 주는 것**이라, 자동으로 초록을 칠하면
 * 그 초록은 우리가 한 일이 아니라 우리가 못 하는 일을 가린 것이 됩니다.
 *
 * 대신 단계마다 담당·증거·상태를 모아 옵니다. 판정은 `@acos/core`가 합니다.
 */
@Injectable()
export class ValidationPlanService {
  private readonly logger = new Logger(ValidationPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cutover: ProductionCutoverService,
    private readonly smoke: ProductionSmokeService,
    private readonly diagnostics: DiagnosticsService,
    private readonly notifications: NotificationService,
  ) {}

  async report(now = Date.now()): Promise<ValidationPlanDto> {
    const [activation, cutover, smoke, diagnostics, snapshots, drill] = await Promise.all([
      this.activation(),
      this.cutoverCounts(),
      this.smokeCounts(),
      this.diagnosticCounts(),
      this.prisma.kpiSnapshot
        .groupBy({ by: ["takenAt"] })
        .then((rows) => rows.length)
        .catch(() => 0),
      this.prisma.recoveryDrill
        .findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
        .catch(() => null),
    ]);

    const report = judgeValidationPlan({
      activation,
      cutover,
      smoke,
      diagnostics,
      // 진단이 이미 마이그레이션을 보고 있으므로 같은 판정을 두 번 하지
      // 않는다 — 두 곳에서 세면 서로 다른 답이 나오는 날이 온다
      pendingMigrations: diagnostics === null ? null : diagnostics.pendingMigrations,
      urgentChannelConfigured: this.notifications
        .urgentStatus()
        .some((row) => row.configured),
      // **보호 판정을 그대로 쓴다** (TASK-4101, 정책 4101-①). 주소가 비어
      // 있지 않다는 것만 보면, 운영을 가리키는 주소도 "검증용 환경 확보
      // 완료"가 된다 — 같은 값을 두 곳에서 다르게 판정하던 결함이다.
      stagingTarget: (() => {
        const target = this.diagnostics.validationTarget();
        return { url: target.url, usable: target.usable, detail: target.detail };
      })(),
      // 운영 호스트 목록 (TASK-4201, 정책 4201-①⑤) — 검증 대상 보호는 이
      // 목록과 대조해서 동작하므로, 목록이 비어 있으면 보호가 지켜 주는
      // 것이 아니라 통과시키고 있을 뿐이다
      hosts: (() => {
        try {
          const report = this.diagnostics.hosts();
          return { declared: report.declared, undeclared: report.undeclared.length };
        } catch (error) {
          this.logger.warn(`운영 호스트 목록을 읽지 못했습니다: ${String(error)}`);
          return null;
        }
      })(),
      kpiSnapshots: snapshots,
      lastDrillAt: drill?.createdAt.getTime() ?? null,
      now,
    });

    if (report.readiness !== "ready") {
      this.logger.log(`검증 스프린트 준비: ${report.detail}`);
    }

    return {
      steps: report.steps.map((step) => ({
        id: step.id,
        title: step.title,
        owner: step.owner,
        why: step.why,
        evidence: step.evidence,
        status: step.status,
        detail: step.detail,
        blockedBy: step.blockedBy,
      })),
      readiness: report.readiness,
      done: report.done,
      total: VALIDATION_STEPS.length,
      waitingOnPeople: report.waitingOnPeople.length,
      waitingOnUs: report.waitingOnUs.length,
      unknown: report.unknown.length,
      blocked: report.blocked.length,
      detail: report.detail,
      checkedAt: new Date(now).toISOString(),
    };
  }

  private async activation(): Promise<{ id: string; met: boolean }[] | null> {
    try {
      const report = await this.cutover.activation();
      return report.conditions.map((condition) => ({
        id: condition.id,
        met: condition.met,
      }));
    } catch (error) {
      // 못 읽은 것은 "안 됐다"가 아니라 "모른다"다
      this.logger.warn(`활성화 상태를 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  private async cutoverCounts(): Promise<{
    verified: number;
    total: number;
    notProduction: number;
  } | null> {
    try {
      const report = await this.cutover.report();
      return {
        verified: report.summary.verified,
        total: report.summary.total,
        // 스텁을 상대로 돌고 있는 것은 "돌고 있다"이지 "전환됐다"가 아니다
        notProduction: report.dependencies.filter(
          (row) => row.status === "not-production",
        ).length,
      };
    } catch (error) {
      this.logger.warn(`전환 검증 결과를 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  private async smokeCounts(): Promise<{
    passed: number;
    total: number;
    stubbed: number;
  } | null> {
    try {
      const latest = await this.smoke.latest();
      // **한 번도 안 돌린 것을 0/3 실패로 세지 않는다** — 아직 안 한 것이다
      if (latest.results.every((row) => row.status === "skipped")) {
        return null;
      }
      return {
        passed: latest.results.filter((row) => row.status === "passed").length,
        total: latest.results.length,
        stubbed: latest.results.filter((row) => row.status === "stubbed").length,
      };
    } catch (error) {
      this.logger.warn(`스모크 결과를 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  private async diagnosticCounts(): Promise<{
    fail: number;
    unknown: number;
    pendingMigrations: number | null;
  } | null> {
    try {
      const report = await this.diagnostics.run("daily");
      const migrations = report.checks.find((check) => check.id === "migrations");
      return {
        fail: report.fail,
        unknown: report.unknown,
        pendingMigrations:
          migrations === undefined || migrations.status === "unknown"
            ? null
            : migrations.status === "ok"
              ? 0
              : 1,
      };
    } catch (error) {
      this.logger.warn(`진단을 돌리지 못했습니다: ${String(error)}`);
      return null;
    }
  }
}
