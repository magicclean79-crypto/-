import { Injectable, Logger } from "@nestjs/common";
import { buildGoLiveChecklist } from "@acos/core";
import type { GoLiveState } from "@acos/core";
import type { GoLiveChecklistDto } from "@acos/shared";
import { ActivationRunbookService } from "./activation-runbook.service";
import { DiagnosticsService } from "./diagnostics.service";
import { NeglectService } from "./neglect.service";
import { NotificationService } from "./notification.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProjectCostService } from "./project-cost.service";
import { RecoveryDrillService } from "./recovery-drill.service";
import { ValidationRunService } from "./validation-run.service";

/**
 * 최종 Go-Live 체크리스트. (TASK-4501, Sprint 45 — CTO 정책 4501-⑤)
 *
 * **여기서 새로 판정하지 않습니다** — 각 항목은 이미 있는 판정을 인용하고,
 * 못 읽으면 `unknown`입니다(통과가 아닙니다). 준비 화면(4301-④)·런북
 * (4401-⑤)과 같은 규칙입니다.
 *
 * 이 화면을 부르는 쪽이 준비 화면이 아니라는 점이 중요합니다: 준비 화면이
 * Go-Live를 인용하고 Go-Live가 준비 화면을 인용하면 서로를 부르는 고리가
 * 됩니다. Go-Live는 **원본 판정만** 인용합니다.
 */
@Injectable()
export class GoLiveService {
  private readonly logger = new Logger(GoLiveService.name);

  constructor(
    private readonly validation: ValidationRunService,
    private readonly runbook: ActivationRunbookService,
    private readonly cutover: ProductionCutoverService,
    private readonly diagnostics: DiagnosticsService,
    private readonly notifications: NotificationService,
    private readonly cost: ProjectCostService,
    private readonly drills: RecoveryDrillService,
    private readonly neglect: NeglectService,
  ) {}

  async report(now = Date.now()): Promise<GoLiveChecklistDto> {
    const states: Record<string, { state: GoLiveState; detail: string }> = {};
    const set = (id: string, state: GoLiveState, detail: string): void => {
      states[id] = { state, detail };
    };

    // **"읽지 못했다"와 "아직 안 돌렸다"를 섞지 않습니다.** 둘 다 통과가
    // 아니지만 사람이 할 일이 다릅니다 — 앞은 고칠 버그이고 뒤는 할 일입니다.
    const validationRead = await this.safe("검증 실행 기록", async () => ({
      run: await this.validation.latest(),
    }));
    const lastValidation = validationRead?.run ?? null;
    if (validationRead !== null) {
      set(
        "validation",
        lastValidation !== null && lastValidation.status === "success" ? "met" : "unmet",
        lastValidation === null
          ? "실 Production Validation을 아직 한 번도 돌린 적이 없습니다 — 실패가 아니라 안 한 것입니다."
          : `마지막 검증(${lastValidation.startedAt}): ${lastValidation.detail}`,
      );
    }

    const runbook = await this.safe("운영 활성화 런북", () => this.runbook.report(now));
    if (runbook !== null) {
      set(
        "runbook",
        runbook.done === runbook.total ? "met" : "unmet",
        runbook.detail,
      );
    }

    const cutover = await this.safe("전환 검증", () => this.cutover.report());
    if (cutover !== null) {
      const notProduction = cutover.dependencies.filter(
        (row) => row.status === "not-production",
      ).length;
      set(
        "cutover",
        cutover.summary.total > 0 &&
          cutover.summary.verified === cutover.summary.total &&
          notProduction === 0
          ? "met"
          : "unmet",
        `전환 검증 ${cutover.summary.verified}/${cutover.summary.total} · ` +
          `공식 주소가 아닌 대상 ${notProduction}건.`,
      );
    }

    const hosts = await this.safe("운영 호스트 목록", () => this.diagnostics.hosts(now));
    if (hosts !== null) {
      // 관측이 잘렸으면 "목록에 없는 호스트 0개"는 사실이 아니라 우리가 더
      // 안 본 것입니다 — 그 상태를 충족으로 세지 않습니다.
      const truncated = hosts.discovery.overflowed;
      set(
        "hosts",
        hosts.report.declared > 0 &&
          hosts.report.undeclared.length === 0 &&
          !truncated
          ? "met"
          : "unmet",
        truncated
          ? `${hosts.report.detail} 관측이 상한에서 잘렸습니다 — "없다"가 아니라 "더 안 봤다"입니다.`
          : hosts.report.detail,
      );
    }

    const delivery = await this.safe("알림 도달", () => this.deliveryEvidence());
    if (delivery !== null) {
      set("alerts", delivery.ok ? "met" : "unmet", delivery.detail);
    }

    const attribution = await this.safe("비용 귀속", () => this.cost.gap(undefined, now));
    if (attribution !== null) {
      // 표본이 적으면 달성이라고 말하지 않습니다 — met은 verdict가 met일
      // 때뿐이고, insufficient는 미달이 아니라 판정 보류이지만 Go-Live에는
      // 통과가 아닙니다.
      set(
        "attribution",
        attribution.verdict === "met" ? "met" : "unmet",
        attribution.detail,
      );
    }

    const drills = await this.safe("복구 리허설", () => this.drills.history(1));
    if (drills !== null) {
      const last = drills[0] ?? null;
      set(
        "drill",
        last !== null && last.ok ? "met" : "unmet",
        last === null
          ? "복구 리허설 기록이 없습니다 — 실패가 아니라 아직 안 한 것입니다."
          : `마지막 리허설: ${last.ok ? "성공" : "실패"} (${last.createdAt}).`,
      );
    }

    const neglect = await this.safe("방치", () =>
      this.neglect.report(this.diagnostics.tier(), "daily", now),
    );
    if (neglect !== null) {
      // 무시는 해결이 아닙니다. 다만 이유·담당·재검토일이 적힌 무시는
      // 사라지지 않으므로, 검토일이 지난 무시가 없다면 통과로 봅니다.
      const remaining = neglect.streaks.length;
      set(
        "neglect",
        remaining === 0 || (neglect.ignoredCount >= remaining && neglect.overdueCount === 0)
          ? "met"
          : "unmet",
        neglect.detail,
      );
    }

    const report = buildGoLiveChecklist({ states });
    if (report.verdict !== "declarable") {
      this.logger.log(`Go-Live 체크리스트: ${report.detail}`);
    }

    return {
      verdict: report.verdict,
      items: report.items.map((item) => ({
        id: item.id,
        title: item.title,
        why: item.why,
        evidence: item.evidence,
        source: item.source,
        state: item.state,
        detail: item.detail,
      })),
      met: report.met,
      total: report.total,
      blocking: report.blocking,
      lastValidation: lastValidation ?? null,
      detail: report.detail,
      checkedAt: new Date(now).toISOString(),
    };
  }

  /**
   * 경보가 실제로 도달하는가.
   *
   * **채널이 설정돼 있다는 것과 실제로 도달한다는 것은 다른 사실입니다.**
   * 설정만 보고 통과시키면, 주소가 살아 있는지는 첫 장애 때 알게 됩니다.
   */
  private async deliveryEvidence(): Promise<{ ok: boolean; detail: string }> {
    const configs = this.notifications.channelConfigs();
    const enabled = configs.filter((row) => row.enabled).map((row) => row.channel);
    if (enabled.length === 0) {
      return {
        ok: false,
        detail:
          "켜진 알림 채널이 없습니다 — 장애를 감지해도 아무도 못 받으면 " +
          "감지하지 않은 것과 같습니다.",
      };
    }
    const succeeded = await this.notifications.recentSuccessChannels();
    const never = enabled.filter((channel) => !succeeded.includes(channel));
    if (never.length > 0) {
      return {
        ok: false,
        detail:
          `켜진 채널 ${enabled.join(" · ")} 중 ${never.join(" · ")}은(는) ` +
          "한 번도 도달에 성공한 기록이 없습니다. 설정돼 있다는 것과 " +
          "실제로 닿는다는 것은 다른 사실입니다.",
      };
    }
    return {
      ok: true,
      detail: `켜진 채널 ${enabled.join(" · ")} 모두 최근 도달 기록이 있습니다.`,
    };
  }

  /** 하나가 죽어도 화면은 뜬다 — 대신 그 항목은 "못 봤다"로 남는다 */
  private async safe<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`${label}을 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }
}
