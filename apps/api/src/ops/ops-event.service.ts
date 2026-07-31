import { Injectable, Logger } from "@nestjs/common";
import { judgeActivationEvent } from "@acos/core";
import type { ActivationEvent, ActivationSnapshot } from "@acos/core";
import type { OpsEventDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationService } from "./notification.service";

/**
 * 운영 이벤트. (TASK-3801, Sprint 38 — CTO 정책 3801-①)
 *
 * 상태가 **경계를 넘는 순간**을 기록하고 내보냅니다. 판정은 `@acos/core`가
 * 하고, 여기서는 저장·발송만 합니다.
 *
 * ## 두 번 알리지 않는 방법
 *
 * `/ops/activation`은 화면을 열 때마다 불립니다. 판정이 매번 같은 전이를
 * 만들어 내도, 같은 `key`는 **표의 유니크 제약**이 막습니다 — 애플리케이션
 * 로직으로만 막으면 두 인스턴스가 동시에 판정할 때 둘 다 통과합니다
 * (그리고 운영자는 같은 알림을 두 번 받습니다).
 *
 * ## 발송 실패를 성공으로 적지 않는다
 *
 * `notifiedAt`은 큐에 **담긴** 뒤에만 채웁니다. 못 담았으면 `null`로
 * 남기고 로그에 남깁니다 — "알렸다"고 적힌 기록을 믿고 아무도 확인하지
 * 않는 상황이 가장 나쁩니다.
 */
@Injectable()
export class OpsEventService {
  private readonly logger = new Logger(OpsEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueueService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * 활성화 전이를 이벤트로 만든다 (CTO 정책 3801-①).
   *
   * 이벤트 처리 실패가 판정을 막지 않습니다 — 알림 때문에 화면이 안 뜨면
   * 그것이 더 큰 사고입니다.
   */
  async recordActivationTransition(
    previous: ActivationSnapshot | null,
    current: ActivationSnapshot,
  ): Promise<ActivationEvent | null> {
    const event = judgeActivationEvent(previous, current);
    if (event === null) {
      return null;
    }
    try {
      const existing = await this.prisma.opsEvent.findUnique({
        where: { key: event.key },
      });
      if (existing !== null) {
        return null; // 이미 알린 전이다
      }

      const created = await this.prisma.opsEvent.create({
        data: {
          kind: event.kind,
          key: event.key,
          title: event.title,
          message: event.message,
          urgent: event.urgent,
          environment: current.environment,
        },
      });

      if (event.urgent) {
        this.logger.error(`[${event.kind}] ${event.title} — ${event.message}`);
      } else {
        this.logger.log(`[${event.kind}] ${event.title} — ${event.message}`);
      }

      try {
        await this.queue.enqueue({
          // 풀린 것은 critical, 완료는 resolved(좋은 소식) 등급으로 나간다 —
          // 등급을 섞으면 사람이 색으로 급한 것을 가려내지 못한다
          level: event.urgent ? "critical" : "resolved",
          kind: event.kind,
          key: event.key,
          title: event.title,
          message: event.message,
          at: new Date().toISOString(),
          environment: current.environment,
          url: this.notifications.alertUrl(),
        });
        await this.prisma.opsEvent.update({
          where: { id: created.id },
          data: { notifiedAt: new Date() },
        });
      } catch (error) {
        // 못 보냈으면 못 보낸 채로 둔다 — "알렸다"고 적지 않는다
        this.logger.warn(`운영 이벤트 알림 적재 실패: ${String(error)}`);
      }
      return event;
    } catch (error) {
      this.logger.warn(`운영 이벤트 기록 실패 (판정은 계속합니다): ${String(error)}`);
      return null;
    }
  }

  async recent(limit = 50): Promise<OpsEventDto[]> {
    const rows = await this.prisma.opsEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      message: row.message,
      urgent: row.urgent,
      environment: row.environment,
      notifiedAt: row.notifiedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
