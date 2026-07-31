import { Injectable, Logger } from "@nestjs/common";
import { detectEscalationAlerts, planIgnoreNotices } from "@acos/core";
import type {
  DetectedAlert,
  DeploymentTier,
  IgnoreNoticeStage,
  IgnoreWithNotice,
} from "@acos/core";
import type { IgnoreNoticePlanDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "./notification.service";

/**
 * 무시 검토일 알림과 에스컬레이션. (TASK-4401, Sprint 44 — CTO 정책 4401-③)
 *
 * TASK-4301의 무시는 검토일이 지나면 자동으로 풀려 **경보 채널로**
 * 돌아왔습니다. 그런데 그 경보는 담당자에게 가지 않습니다 — 채널을 보는
 * 사람과 항목을 맡은 사람이 대개 다르고, 그러면 "돌아온 경보"가 다시 아무도
 * 안 보는 자리에 쌓입니다.
 *
 * 판정(언제·누구에게·어떤 강도로)은 전부 `@acos/core`가 합니다. 여기서
 * 하는 일은 읽고, 보내고, **보낸 사실만** 남기는 것입니다.
 *
 * **알림은 무시의 상태를 바꾸지 않습니다.** 검토일이 밀리지도, 무시가
 * 되살아나지도 않습니다 — 알림이 상태를 바꾸면 보내는 것만으로 문제가
 * 사라지는 셈이 됩니다.
 */
@Injectable()
export class IgnoreEscalationService {
  private readonly logger = new Logger(IgnoreEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** 지금 보낼 알림 계획 — 아무것도 보내지 않고 계획만 낸다 */
  async plan(tier: DeploymentTier, now = Date.now()): Promise<IgnoreNoticePlanDto> {
    const report = planIgnoreNotices({ ignores: await this.ignores(tier), now });
    return {
      notices: report.notices.map((notice) => ({
        checkId: notice.checkId,
        tier: notice.tier,
        owner: notice.owner,
        stage: notice.stage,
        broadcast: notice.broadcast,
        // 이 담당자에게 직접 갈 수 있는가 (TASK-4601, 정책 4601-④).
        // **조회는 아무것도 보내지 않습니다** — 경로만 미리 보여 줍니다.
        directRoute: this.notifications.ownerRoute(notice.owner).verdict,
        title: notice.title,
        message: notice.message,
      })),
      quiet: report.quiet,
      suppressed: report.suppressed,
      detail: report.detail,
      checkedAt: new Date(now).toISOString(),
    };
  }

  /**
   * 알림을 실제로 보내고 보낸 사실을 남긴다.
   *
   * 담당자 알림은 일반 채널로 갑니다. **운영 채널로 넓히는 단계만**
   * 경보가 되며(그 판정도 core가 합니다), 등급은 올리지 않습니다 — 오래된
   * 소식이 지금 터진 장애와 같은 소리로 울리면 진짜 장애가 묻힙니다.
   */
  async run(
    tier: DeploymentTier,
    alerting: boolean,
    now = Date.now(),
  ): Promise<{ sent: number; direct: number; alerts: DetectedAlert[]; detail: string }> {
    const ignores = await this.ignores(tier);
    const report = planIgnoreNotices({ ignores, now });

    let sent = 0;
    let direct = 0;
    for (const notice of report.notices) {
      // 담당자에게 직접 보낼 수 있으면 직접도 보냅니다 (TASK-4601, 정책
      // 4601-④). **공용 채널을 대신하지 않고 더합니다** — 직접 경로가
      // 생겼다고 공용을 끄면 담당자가 휴가 중일 때 그 항목은 아무도 모르는
      // 채로 지나갑니다.
      const route = this.notifications.ownerRoute(notice.owner);
      const payload = {
        // 담당자에게 가는 소식이지 장애가 아니다 — 등급을 올리지 않는다
        level: "warning" as const,
        kind: "diagnostics",
        key: `ignore-review:${notice.tier}:${notice.checkId}:${notice.stage}`,
        title: notice.title,
        // 담당자를 못 찾았다는 사실을 본문에 붙입니다 — 연락처가 없다고
        // 조용히 삼키면, 담당자를 적어 둔 것이 오히려 알림을 없앱니다.
        message: route.note === null ? notice.message : `${notice.message}\n\n${route.note}`,
        at: new Date(now).toISOString(),
        environment: tier,
        url: null,
      };

      try {
        if (route.contact !== null) {
          await this.notifications.notifyOwner(notice.owner, payload);
          direct += 1;
        }
        await this.notifications.notify(payload);
        sent += 1;
      } catch (error) {
        // 보내기 실패가 판정을 되돌리지는 않는다 — 다음 주기에 다시 시도한다
        this.logger.warn(`검토 알림을 보내지 못했습니다: ${String(error)}`);
        continue;
      }
      await this.markNotified(notice.tier, notice.checkId, notice.stage, now);
    }

    return {
      sent,
      direct,
      alerts: detectEscalationAlerts(report, { alerting }) as DetectedAlert[],
      detail:
        direct > 0
          ? `${report.detail} 이 중 ${direct}건은 담당자에게 직접도 보냈습니다.`
          : report.detail,
    };
  }

  /**
   * 보낸 사실만 남긴다 — **검토일과 무시 상태는 건드리지 않는다.**
   *
   * 보내기에 실패한 것은 표시하지 않습니다: 표시해 두면 다음 주기에
   * 건너뛰고, 그러면 아무도 못 받은 알림이 "보냈다"로 남습니다.
   */
  private async markNotified(
    tier: string,
    checkId: string,
    stage: IgnoreNoticeStage,
    now: number,
  ): Promise<void> {
    await this.prisma.neglectDecision
      .updateMany({
        where: { tier, checkId, revokedAt: null },
        data: { lastStage: stage, lastNotifiedAt: new Date(now) },
      })
      .catch((error: unknown) => {
        this.logger.warn(`알림 이력을 남기지 못했습니다: ${String(error)}`);
        return { count: 0 };
      });
  }

  private async ignores(tier: DeploymentTier): Promise<IgnoreWithNotice[]> {
    const rows = await this.prisma.neglectDecision
      .findMany({ where: { tier, revokedAt: null }, orderBy: { reviewAt: "asc" } })
      .catch((error: unknown) => {
        this.logger.warn(`무시 결정을 읽지 못했습니다: ${String(error)}`);
        return [];
      });
    return rows.map((row) => ({
      id: row.id,
      checkId: row.checkId,
      // 항목 제목은 진단이 만들고 무시 결정에는 없습니다 — 지어내지 않고
      // id를 그대로 씁니다(core가 제목이 없으면 id를 쓰도록 돼 있습니다)
      tier: row.tier,
      reason: row.reason,
      owner: row.owner,
      reviewAt: row.reviewAt.getTime(),
      decidedAt: row.decidedAt.getTime(),
      decidedBy: row.decidedById ?? "unknown",
      lastStage: (row.lastStage as IgnoreNoticeStage | null) ?? null,
      lastNotifiedAt: row.lastNotifiedAt?.getTime() ?? null,
    }));
  }
}
