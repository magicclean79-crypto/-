import { Injectable, Logger } from "@nestjs/common";
import { buildOpsOverview } from "@acos/core";
import type { OverviewStatus } from "@acos/core";
import type { OpsOverviewDto } from "@acos/shared";
import { GoLiveService } from "./go-live.service";
import { NotificationService } from "./notification.service";
import { ProjectCostService } from "./project-cost.service";
import { RecoveryDrillService } from "./recovery-drill.service";

/**
 * 통합 운영 대시보드. (TASK-4601, Sprint 46 — CTO 정책 4601-⑤)
 *
 * 네 갈래를 한 화면에 모읍니다: Validation · Attribution · Notification ·
 * Recovery. **여기서 새로 판정하지 않습니다** — 원본 판정을 부르고 그
 * 결론을 그대로 넘기며, 각 칸은 어느 판정에서 왔는지를 달고 다닙니다
 * (4301-④ · 4401-⑤ · 4501-⑤와 같은 규칙).
 *
 * 한 갈래가 죽어도 나머지는 보여야 합니다 — 통합 화면이 통째로 죽으면
 * 사람은 다시 화면 네 개를 열게 되고, 그러면 이 기능은 없는 것과 같습니다.
 */
@Injectable()
export class OpsOverviewService {
  private readonly logger = new Logger(OpsOverviewService.name);

  constructor(
    private readonly goLive: GoLiveService,
    private readonly cost: ProjectCostService,
    private readonly notifications: NotificationService,
    private readonly drills: RecoveryDrillService,
  ) {}

  async report(now = Date.now()): Promise<OpsOverviewDto> {
    const states: Record<
      string,
      { status: OverviewStatus; detail: string; next?: string | null }
    > = {};

    const goLive = await this.safe("Go-Live 판정", () => this.goLive.report(now));
    if (goLive !== null) {
      // 검증이 성공하지 않은 상태를 `warn`으로 두지 않습니다 — 실 Provider를
      // 상대로 확인한 것이 하나도 없다는 뜻이고, 그건 주의가 아닙니다.
      states.validation = {
        status:
          goLive.verdict === "declarable"
            ? "ok"
            : goLive.verdict === "not-started"
              ? "fail"
              : "warn",
        detail: goLive.detail,
        next:
          goLive.verdict === "declarable"
            ? null
            : goLive.blocking.length > 0
              ? `남은 조건: ${goLive.blocking.join(" · ")}`
              : null,
      };
    }

    const attribution = await this.safe("비용 귀속", () => this.cost.gap(undefined, now));
    if (attribution !== null) {
      // 표본이 적으면 달성이라고 말하지 않습니다(4401-②) — 그 상태는
      // 정상도 미달도 아니므로 `unknown`입니다.
      states.attribution = {
        status:
          attribution.verdict === "met"
            ? "ok"
            : attribution.verdict === "insufficient"
              ? "unknown"
              : "warn",
        detail: attribution.detail,
        next: attribution.next,
      };
    }

    const health = await this.safe("알림 건강도", () => this.notifications.health(now));
    if (health !== null) {
      states.notification = {
        status: health.status as OverviewStatus,
        detail: health.detail,
        next: health.channels.find((row) => row.next !== null)?.next ?? null,
      };
    }

    const drills = await this.safe("복구 리허설", () => this.drills.history(1));
    if (drills !== null) {
      const last = drills[0] ?? null;
      states.recovery = {
        status: last === null ? "unknown" : last.ok ? "ok" : "fail",
        detail:
          last === null
            ? "복구 리허설 기록이 없습니다 — 실패가 아니라 아직 안 한 것입니다."
            : `마지막 리허설: ${last.ok ? "성공" : "실패"} (${last.createdAt}).`,
        next:
          last === null
            ? "POST /ops/drills로 절차를 한 번 밟아 보세요."
            : last.ok
              ? null
              : "실패한 단계를 먼저 고치세요 — 되돌릴 수 없으면 그건 검증이 아니라 그냥 전환입니다.",
      };
    }

    const report = buildOpsOverview({ states });
    if (report.status !== "ok") {
      this.logger.log(`통합 운영 상태: ${report.detail}`);
    }

    return {
      tiles: report.tiles.map((tile) => ({
        id: tile.id,
        title: tile.title,
        question: tile.question,
        source: tile.source,
        status: tile.status,
        detail: tile.detail,
        next: tile.next,
        read: tile.read,
      })),
      status: report.status,
      unknown: report.unknown,
      unread: report.unread,
      undecided: report.undecided,
      detail: report.detail,
      nextAction: report.nextAction,
      checkedAt: new Date(now).toISOString(),
    };
  }

  /** 하나가 죽어도 화면은 뜬다 — 대신 그 갈래는 "못 봤다"로 남는다 */
  private async safe<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`${label}을 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }
}
