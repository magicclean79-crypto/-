import { Injectable, Logger } from "@nestjs/common";
import { buildReadinessBoard } from "@acos/core";
import type { ReadinessBoardDto } from "@acos/shared";
import { DiagnosticsService } from "./diagnostics.service";
import { NeglectService } from "./neglect.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProjectCostService, MIN_ATTRIBUTION_COVERAGE } from "./project-cost.service";
import { ValidationPlanService } from "./validation-plan.service";
import { ValidationRunService } from "./validation-run.service";
import { ActivationRunbookService } from "./activation-runbook.service";

/**
 * Production Readiness Dashboard. (TASK-4301, Sprint 43 — CTO 정책 4301-④)
 *
 * 여섯 판정을 한 화면에 모읍니다. **여기서 새로 판정하지 않습니다** — 각
 * 판정을 부르고 그 결론을 그대로 넘길 뿐입니다. 어느 하나를 읽지 못하면
 * 그 칸은 `unknown`이며, **못 본 것을 통과로 세지 않습니다.**
 *
 * 한 판정이 실패해도 나머지는 보여야 합니다 — 대시보드가 통째로 죽으면
 * 사람은 다시 화면 여섯 개를 열게 되고, 그러면 이 기능은 없는 것과 같습니다.
 */
@Injectable()
export class ReadinessBoardService {
  private readonly logger = new Logger(ReadinessBoardService.name);

  constructor(
    private readonly plan: ValidationPlanService,
    private readonly run: ValidationRunService,
    private readonly diagnostics: DiagnosticsService,
    private readonly cutover: ProductionCutoverService,
    private readonly neglect: NeglectService,
    private readonly cost: ProjectCostService,
    private readonly runbook: ActivationRunbookService,
  ) {}

  async report(now = Date.now()): Promise<ReadinessBoardDto> {
    const tier = this.diagnostics.tier();

    const [plan, runGate, diagnostics, cutover, hosts, neglect, attribution, runbook] =
      await Promise.all([
        this.safe("검증 준비 단계", () => this.plan.report(now)),
        this.safe("검증 실행 잠금", () => this.run.gate(now)),
        this.safe("운영 진단", () => this.diagnostics.run("daily", now)),
        this.safe("전환 검증", () => this.cutover.report()),
        this.safe("운영 호스트 목록", () => this.diagnostics.hosts(now)),
        this.safe("방치", () => this.neglect.report(tier, "daily", now)),
        this.safe("비용 귀속", () => this.cost.report(undefined, now)),
        this.safe("운영 활성화 런북", () => this.runbook.report(now)),
      ]);

    const board = buildReadinessBoard({
      plan:
        plan === null
          ? null
          : {
              readiness: plan.readiness as "ready" | "blocked" | "not-ready",
              done: plan.done,
              total: plan.total,
              waitingOnPeople: plan.steps.filter(
                (step) =>
                  step.owner === "operator" &&
                  step.status !== "done" &&
                  step.status !== "blocked",
              ),
              waitingOnUs: plan.steps.filter(
                (step) =>
                  step.owner === "system" &&
                  step.status !== "done" &&
                  step.status !== "blocked",
              ),
              detail: plan.detail,
            },
      runGate:
        runGate === null
          ? null
          : {
              allowed: runGate.verdict === "allowed",
              reasons: runGate.blockers.map((row) => row.reason),
            },
      diagnostics:
        diagnostics === null
          ? null
          : {
              fail: diagnostics.fail,
              warn: diagnostics.warn,
              unknown: diagnostics.unknown,
              detail: diagnostics.detail,
            },
      cutover:
        cutover === null
          ? null
          : {
              verified: cutover.summary.verified,
              total: cutover.summary.total,
              notProduction: cutover.dependencies.filter(
                (row) => row.status === "not-production",
              ).length,
            },
      hosts:
        hosts === null
          ? null
          : {
              declared: hosts.report.declared,
              undeclared: hosts.report.undeclared.length,
              detail: hosts.report.detail,
            },
      neglect:
        neglect === null
          ? null
          : {
              neglected: neglect.streaks.filter(
                (row) => row.durationDays >= neglect.neglectAfterDays,
              ).length,
              ignored: neglect.ignoredCount,
              overdue: neglect.overdueCount,
              worstLabel:
                neglect.worst === null
                  ? null
                  : `${neglect.worst.title}(${neglect.worst.durationLabel}째)`,
            },
      attribution:
        attribution === null
          ? null
          : {
              coverage: attribution.coverage,
              recentCoverage: attribution.recentCoverage,
              minCoverage: MIN_ATTRIBUTION_COVERAGE,
            },
      // 런북은 **인용만** 한다 (정책 4401-⑤) — 여기서 다시 세지 않는다
      runbook:
        runbook === null
          ? null
          : {
              done: runbook.done,
              total: runbook.total,
              nextTitle:
                runbook.steps.find((step) => step.id === runbook.nextStepId)?.title ??
                null,
              detail: runbook.detail,
            },
      tier,
      checkedAt: new Date(now).toISOString(),
    });

    return {
      tiles: board.tiles,
      steps: board.steps,
      readiness: board.readiness,
      blockers: board.blockers.map((tile) => tile.id),
      unknowns: board.unknowns.map((tile) => tile.id),
      fail: board.fail,
      warn: board.warn,
      tier,
      detail: board.detail,
      checkedAt: board.checkedAt,
    };
  }

  /** 하나가 죽어도 화면은 뜬다 — 대신 그 칸은 "못 봤다"로 남는다 */
  private async safe<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`${label} 판정을 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }
}
