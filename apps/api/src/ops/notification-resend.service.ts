import { Injectable, Logger } from "@nestjs/common";
import { planResends, resendNotice, RESEND_MAX_ROUNDS } from "@acos/core";
import type {
  FailedDelivery,
  NotificationChannel,
  NotificationLevel,
  NotificationPayload,
  ResendPlanItem,
} from "@acos/core";
import type { ResendPlanDto, ResendRunDto } from "@acos/shared";

import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "./notification.service";

/**
 * 알림 재전송. (TASK-4601, Sprint 46 — CTO 정책 4601-④)
 *
 * 재시도는 한 번의 전송 안에서 초 단위로 일어나고 4회 만에 끝납니다.
 * 슬랙이 5분 죽어 있었다면 그 사이의 경보는 **영영 전달되지 않았고**,
 * 사람은 장애가 있었다는 사실 자체를 몰랐습니다.
 *
 * 판정은 전부 `@acos/core`가 합니다 — 여기서는 읽고, 보내고, 기록합니다.
 *
 * **조회는 아무것도 보내지 않습니다**(4401-③과 같은 규칙). 계획을 보는 것과
 * 보내는 것은 다른 행동이고, 화면을 열었다고 알림이 나가면 화면을 못 엽니다.
 */
@Injectable()
export class NotificationResendService {
  private readonly logger = new Logger(NotificationResendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** 재전송 계획 — 아무것도 보내지 않는다 */
  async plan(now = Date.now()): Promise<ResendPlanDto> {
    const built = await this.build(now);
    return toDto(built.plan.items, built.plan.detail, now);
  }

  /**
   * 계획대로 실제로 보낸다.
   *
   * 보내는 본문에 **몇 번째 재전송인지** 붙입니다 — 안 붙이면 받는 사람은
   * 같은 알림이 여러 번 온 것으로 읽고, 그러면 한 장애를 여러 장애로
   * 착각합니다.
   */
  async run(now = Date.now()): Promise<ResendRunDto> {
    const built = await this.build(now);
    let sent = 0;
    let failed = 0;

    for (const item of built.plan.resend) {
      const source = built.payloads.get(item.delivery.id);
      if (source === undefined) {
        continue;
      }
      const round = item.round ?? item.delivery.rounds + 1;
      const payload: NotificationPayload = {
        ...source,
        message: `${resendNotice(round, item.delivery.firstAttemptAt, now)}\n\n${source.message}`,
      };
      const result = await this.notifications.sendOnce(item.delivery.channel, payload);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
      }
      await this.markResent(item.delivery.id, round, result.ok, now);
    }

    // 포기한 것은 **표시하고 남깁니다.** 조용히 그만두면 아무도 못 받은
    // 알림이 없는 일이 됩니다.
    for (const item of built.plan.givenUp) {
      await this.markGaveUp(item.delivery.id, now, item.detail);
    }

    const detail =
      `${built.plan.detail} 실제로 ${sent}건 보냈고 ${failed}건은 다시 실패했습니다.` +
      (built.plan.givenUp.length > 0
        ? ` 포기한 ${built.plan.givenUp.length}건은 목록에 남습니다 — 받지 못한 채로 끝난 알림입니다.`
        : "");
    if (sent > 0 || failed > 0 || built.plan.givenUp.length > 0) {
      this.logger.log(`알림 재전송: ${detail}`);
    }

    return { ...toDto(built.plan.items, detail, now), sent, failed };
  }

  private async build(now: number): Promise<{
    plan: ReturnType<typeof planResends>;
    payloads: Map<string, NotificationPayload>;
  }> {
    const since = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.notificationDelivery
      .findMany({
        where: { ok: false, gaveUpAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
      .catch((error: unknown) => {
        this.logger.warn(`전송 이력을 읽지 못했습니다: ${String(error)}`);
        return [];
      });

    // 그 사이에 해소된 경보는 다시 보내지 않습니다 — 끝난 일로 사람을
    // 깨우는 것은 알림을 끄게 만드는 가장 빠른 길입니다.
    const resolved = await this.prisma.notificationDelivery
      .findMany({
        where: { level: "resolved", createdAt: { gte: since } },
        select: { alertKey: true },
      })
      .catch(() => [] as { alertKey: string }[]);

    const failures: FailedDelivery[] = [];
    const payloads = new Map<string, NotificationPayload>();

    for (const row of rows) {
      failures.push({
        id: row.id,
        alertKey: row.alertKey,
        channel: row.channel as NotificationChannel,
        level: row.level as NotificationLevel,
        lastAttemptAt: (row.lastResendAt ?? row.createdAt).getTime(),
        firstAttemptAt: row.createdAt.getTime(),
        status: row.status,
        rounds: row.rounds,
      });
      // 원본 본문은 보관하지 않습니다(주소·본문을 이력에 담지 않는다는
      // 1401의 규칙). 재전송은 **같은 키·같은 등급**으로 다시 알리는
      // 것이며, 본문은 "무엇이 실패했는지"를 그대로 적습니다.
      payloads.set(row.id, {
        level: row.level as NotificationLevel,
        kind: "resend",
        key: row.alertKey,
        title: `전달되지 못한 경보: ${row.alertKey}`,
        message:
          `${row.createdAt.toISOString()}에 ${row.channel}로 보내려다 실패했습니다` +
          `${row.error === null ? "" : ` (${row.error})`}.`,
        at: row.createdAt.toISOString(),
        environment: process.env.DEPLOY_TIER ?? process.env.NODE_ENV ?? "development",
        url: null,
      });
    }

    const plan = planResends({
      failures,
      resolvedKeys: new Set(resolved.map((row) => row.alertKey)),
      now,
    });
    return { plan, payloads };
  }

  private async markResent(
    id: string,
    round: number,
    ok: boolean,
    now: number,
  ): Promise<void> {
    try {
      await this.prisma.notificationDelivery.update({
        where: { id },
        data: {
          rounds: round,
          lastResendAt: new Date(now),
          // 성공하면 이 실패는 끝난 것입니다 — 다만 **시도 이력은 남습니다**
          // (`rounds`가 몇 번 만에 닿았는지 말합니다).
          ok,
          ...(round >= RESEND_MAX_ROUNDS && !ok ? { gaveUpAt: new Date(now) } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(`재전송 기록 실패: ${String(error)}`);
    }
  }

  private async markGaveUp(id: string, now: number, reason: string): Promise<void> {
    try {
      await this.prisma.notificationDelivery.update({
        where: { id },
        data: { gaveUpAt: new Date(now), error: reason },
      });
    } catch (error) {
      this.logger.warn(`포기 기록 실패: ${String(error)}`);
    }
  }
}

function toDto(items: ResendPlanItem[], detail: string, now: number): ResendPlanDto {
  return {
    items: items.map((item) => ({
      id: item.delivery.id,
      alertKey: item.delivery.alertKey,
      channel: item.delivery.channel,
      level: item.delivery.level,
      decision: item.decision,
      round: item.round,
      dueAt: item.dueAt === null ? null : new Date(item.dueAt).toISOString(),
      detail: item.detail,
    })),
    pending: items.filter((item) => item.decision === "resend").length,
    givenUp: items.filter(
      (item) =>
        item.decision === "exhausted" ||
        item.decision === "permanent" ||
        item.decision === "stale",
    ).length,
    detail,
    checkedAt: new Date(now).toISOString(),
  };
}
