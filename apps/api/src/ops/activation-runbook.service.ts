import { Injectable, Logger } from "@nestjs/common";
import { buildRunbook } from "@acos/core";
import type { RunbookState } from "@acos/core";
import type { ActivationRunbookDto } from "@acos/shared";
import { DiagnosticsService } from "./diagnostics.service";
import { KpiTrendService } from "./kpi-trend.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProductionSmokeService } from "./production-smoke.service";
import { RecoveryDrillService } from "./recovery-drill.service";
import { ValidationPlanService } from "./validation-plan.service";

/**
 * 운영 활성화 런북. (TASK-4401, Sprint 44 — CTO 정책 4401-⑤)
 *
 * 준비 단계가 "시작해도 되는가"에 답한다면, 런북은 **"시작한 다음 무엇을
 * 어떤 순서로 하고 잘못되면 어떻게 되돌리는가"** 에 답합니다.
 *
 * **여기서 새로 판정하지 않습니다** — 각 단계의 상태는 이미 있는 판정에서
 * 가져오고, 못 가져오면 `unknown`입니다(통과가 아닙니다).
 */
@Injectable()
export class ActivationRunbookService {
  private readonly logger = new Logger(ActivationRunbookService.name);

  constructor(
    private readonly plan: ValidationPlanService,
    private readonly diagnostics: DiagnosticsService,
    private readonly cutover: ProductionCutoverService,
    private readonly smoke: ProductionSmokeService,
    private readonly trends: KpiTrendService,
    private readonly drills: RecoveryDrillService,
  ) {}

  async report(now = Date.now()): Promise<ActivationRunbookDto> {
    const states: Record<string, { state: RunbookState; detail: string }> = {};
    const set = (id: string, state: RunbookState, detail: string): void => {
      states[id] = { state, detail };
    };

    // **준비 화면을 부르지 않습니다** — 준비 화면이 런북을 인용하므로,
    // 런북이 준비 화면을 다시 부르면 서로를 부르는 고리가 됩니다.
    // 대신 두 화면이 **같은 원본 판정**을 인용합니다.
    const plan = await this.safe("검증 준비 단계", () => this.plan.report(now));
    if (plan !== null) {
      set("preflight", plan.readiness === "ready" ? "done" : "pending", plan.detail);
    }

    const cutover = await this.safe("전환 검증", () => this.cutover.report());
    if (cutover !== null) {
      const notProduction = cutover.dependencies.filter(
        (row) => row.status === "not-production",
      ).length;
      set(
        "cutover",
        cutover.summary.verified === cutover.summary.total &&
          cutover.summary.total > 0 &&
          notProduction === 0
          ? "done"
          : "pending",
        `전환 검증 ${cutover.summary.verified}/${cutover.summary.total} · ` +
          `공식 주소가 아닌 대상 ${notProduction}건.`,
      );
    }

    const hosts = await this.safe("운영 호스트 목록", () => this.diagnostics.hosts(now));
    if (hosts !== null) {
      set(
        "host-inventory",
        hosts.report.declared > 0 && hosts.report.undeclared.length === 0
          ? "done"
          : "pending",
        hosts.report.detail,
      );
    }

    const activation = await this.safe("활성화 조건", () => this.cutover.activation());
    if (activation !== null) {
      const credentials = activation.conditions.find((row) => row.id === "credentials");
      const network = activation.conditions.find((row) => row.id === "network");
      if (credentials !== undefined) {
        set(
          "credentials",
          credentials.met ? "done" : "pending",
          credentials.detail ?? "자격 증명 조건",
        );
      }
      if (network !== undefined) {
        set("egress", network.met ? "done" : "pending", network.detail ?? "네트워크 조건");
      }
    }

    const latest = await this.safe("스모크", () => this.smoke.latest());
    if (latest !== null) {
      const passed = latest.results.filter((row) => row.status === "passed").length;
      const stubbed = latest.results.filter((row) => row.status === "stubbed").length;
      const never = latest.results.every((row) => row.status === "skipped");
      set(
        "smoke",
        never ? "pending" : passed === latest.results.length && stubbed === 0 ? "done" : "pending",
        never
          ? "실 호출 스모크를 아직 돌린 적이 없습니다 — 실패가 아니라 안 한 것입니다."
          : `실 호출 ${passed}/${latest.results.length} 통과 · 스텁 응답 ${stubbed}건.`,
      );
    }

    const trend = await this.safe("KPI 추세", () => this.trends.trend());
    if (trend !== null) {
      // 추세를 낼 수 없는 지표를 뺀 나머지 — 한 점으로는 좋아졌는지 모른다
      const usable = trend.trends.length - trend.unknown;
      set(
        "observe",
        usable > 0 ? "done" : "pending",
        usable > 0
          ? `추세를 낼 수 있는 지표 ${usable}개 — 전환 전후를 비교할 수 있습니다.`
          : "아직 추세를 낼 수 없습니다 — 한 점으로는 좋아졌는지 알 수 없습니다.",
      );
    }

    const drills = await this.safe("복구 리허설", () => this.drills.history(1));
    if (drills !== null) {
      const last = drills[0] ?? null;
      set(
        "rollback-drill",
        last !== null && last.ok ? "done" : "pending",
        last === null
          ? "복구 리허설 기록이 없습니다 — 실패가 아니라 아직 안 한 것입니다."
          : `마지막 리허설: ${last.ok ? "성공" : "실패"} (${last.createdAt}).`,
      );
    }

    const report = buildRunbook({ states });
    if (report.done < report.total) {
      this.logger.log(`운영 활성화 런북: ${report.detail}`);
    }

    return {
      steps: report.steps.map((step) => ({
        id: step.id,
        title: step.title,
        owner: step.owner,
        why: step.why,
        evidence: step.evidence,
        rollback: step.rollback,
        irreversible: step.irreversible,
        source: step.source,
        state: step.state,
        detail: step.detail,
      })),
      done: report.done,
      total: report.total,
      nextStepId: report.nextStep?.id ?? null,
      irreversibleStarted: report.irreversibleStarted,
      waitingOnPeople: report.waitingOnPeople,
      detail: report.detail,
      checkedAt: new Date(now).toISOString(),
    };
  }

  /** 하나가 죽어도 런북은 뜬다 — 대신 그 단계는 "못 봤다"로 남는다 */
  private async safe<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`${label}을 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }
}
