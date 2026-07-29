import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { decideQueueOutcome, selectChannels, summarizeQueue } from "@acos/core";
import type {
  NotificationChannel,
  NotificationPayload,
  QueueItemState,
  RetryPolicy,
} from "@acos/core";
import type { NotificationQueueDto, NotificationQueueStatusDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationService } from "./notification.service";

const QUEUE_LOCK = "notification-queue";
const DEFAULT_WORKER_INTERVAL_MS = 10_000;
/** 한 번에 처리할 항목 수 — 한 인스턴스가 큐 전체를 붙잡지 않도록 */
const BATCH_SIZE = 20;

interface QueueRow {
  id: string;
  alertKey: string;
  channel: string;
  level: string;
  payload: unknown;
  status: "PENDING" | "SENT" | "DEAD";
  attempts: number;
  nextAttemptAt: Date;
  lastStatus: number | null;
  lastError: string | null;
  sentAt: Date | null;
  deadAt: Date | null;
  createdAt: Date;
}

function toDto(row: QueueRow): NotificationQueueDto {
  const payload = row.payload as Partial<NotificationPayload>;
  return {
    id: row.id,
    alertKey: row.alertKey,
    channel: row.channel,
    level: row.level,
    title: payload?.title ?? row.alertKey,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    deadAt: row.deadAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Persistent Notification Queue + Retry Worker + Dead Letter Queue.
 * (TASK-1501, Sprint 15 — CTO 결정 1401-②)
 *
 * TASK-1401의 재시도는 **프로세스 안에서만** 돌아서, 인스턴스가 재시작하면
 * 진행 중이던 재시도가 사라졌다. 이제 전송을 큐에 담고 워커가 꺼내 보낸다 —
 * **재시작을 견딘다**.
 *
 * 설계 원칙:
 * - **큐에 담는 것은 실패하지 않아야 한다.** 담기에 실패하면 알림이 아예
 *   사라지므로, 담기 실패는 로그로 크게 남긴다.
 * - **워커는 리더만 돌린다.** 여러 인스턴스가 같은 항목을 집으면 같은 알림이
 *   여러 번 간다.
 * - **Dead Letter는 지우지 않는다.** 무엇이 전달되지 못했는지 남아 있어야
 *   사람이 고친 뒤 다시 보낼 수 있다.
 */
@Injectable()
export class NotificationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueueService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly locks: DistributedLockService,
  ) {}

  get workerIntervalMs(): number {
    const raw = Number(process.env.ALERT_QUEUE_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0
      ? Math.round(raw)
      : DEFAULT_WORKER_INTERVAL_MS;
  }

  private get enabled(): boolean {
    const value = (process.env.ALERT_QUEUE_WORKER ?? "").trim().toLowerCase();
    return !["off", "false", "0"].includes(value);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        "알림 Retry Worker가 꺼져 있습니다 — 큐에 쌓인 알림이 나가지 않습니다.",
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.drain();
    }, this.workerIntervalMs);
    this.timer.unref?.();
    this.logger.log(
      `알림 Retry Worker 시작 — ${Math.round(this.workerIntervalMs / 1000)}초 간격`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 경보 1건을 대상 채널만큼 큐에 넣는다.
   * 채널 선택은 core의 정책 판정(`selectChannels`)을 그대로 쓴다.
   */
  async enqueue(payload: NotificationPayload): Promise<number> {
    const targets = selectChannels(
      this.notifications.channelConfigs(),
      payload.level,
    );
    if (targets.length === 0) {
      this.logger.warn(
        `[${payload.level}] ${payload.title} — 전달 채널이 없어 로그로만 남깁니다.`,
      );
      return 0;
    }

    try {
      await this.prisma.notificationQueue.createMany({
        data: targets.map((channel) => ({
          alertKey: payload.key,
          channel,
          level: payload.level,
          payload: payload as unknown as object,
        })),
      });
      return targets.length;
    } catch (error) {
      // 담기에 실패하면 알림이 아예 사라진다 — 크게 남긴다
      this.logger.error(
        `알림 큐 적재 실패 (${payload.key}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Retry Worker 한 바퀴 — 보낼 때가 된 항목을 꺼내 전송한다.
   *
   * **리더만 돌린다**(잠금). 잠금을 못 잡으면 조용히 넘긴다 — 다른 인스턴스가
   * 하고 있다는 뜻이라 소음이 될 이유가 없다.
   */
  async drain(options: { force?: boolean } = {}): Promise<{
    processed: number;
    sent: number;
    retried: number;
    dead: number;
    skipped: string | null;
  }> {
    if (this.draining) {
      return { processed: 0, sent: 0, retried: 0, dead: 0, skipped: "이전 실행 진행 중" };
    }
    if (!options.force && !(await this.locks.acquire(QUEUE_LOCK))) {
      return {
        processed: 0,
        sent: 0,
        retried: 0,
        dead: 0,
        skipped: "다른 인스턴스가 큐를 처리 중",
      };
    }

    this.draining = true;
    let sent = 0;
    let retried = 0;
    let dead = 0;
    let processed = 0;

    try {
      const due = (await this.prisma.notificationQueue.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: "asc" },
        take: BATCH_SIZE,
      })) as QueueRow[];

      for (const row of due) {
        processed += 1;
        const attempt = row.attempts + 1;
        const result = await this.notifications.sendOnce(
          row.channel as NotificationChannel,
          row.payload as NotificationPayload,
        );
        const decision = decideQueueOutcome(
          attempt,
          result,
          Date.now(),
          this.policy,
        );

        if (decision.outcome === "sent") {
          sent += 1;
        } else if (decision.outcome === "dead") {
          dead += 1;
          this.logger.error(
            `알림 전달 실패 (Dead Letter) — ${row.channel} / ${row.alertKey}: ${decision.reason}`,
          );
        } else {
          retried += 1;
        }

        await this.prisma.notificationQueue.update({
          where: { id: row.id },
          data: {
            attempts: attempt,
            status:
              decision.outcome === "sent"
                ? "SENT"
                : decision.outcome === "dead"
                  ? "DEAD"
                  : "PENDING",
            nextAttemptAt: new Date(decision.nextAttemptAt),
            lastStatus: result.status,
            lastError: result.ok ? null : (result.error ?? decision.reason),
            ...(decision.outcome === "sent" ? { sentAt: new Date() } : {}),
            ...(decision.outcome === "dead" ? { deadAt: new Date() } : {}),
          },
        });

        await this.notifications.record(
          row.channel as NotificationChannel,
          row.payload as NotificationPayload,
          { ok: result.ok, attempts: attempt, status: result.status, error: result.error },
        );
      }
    } catch (error) {
      this.logger.warn(
        `알림 큐 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.draining = false;
    }

    return { processed, sent, retried, dead, skipped: null };
  }

  private get policy(): RetryPolicy {
    return this.notifications.retryPolicy;
  }

  /** 큐 현황 — 대기·성공·Dead Letter */
  async status(): Promise<NotificationQueueStatusDto> {
    const rows = (await this.prisma.notificationQueue.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    })) as QueueRow[];

    const items: QueueItemState[] = rows.map((row) => ({
      id: row.id,
      channel: row.channel as NotificationChannel,
      attempts: row.attempts,
      status: row.status,
      nextAttemptAt: row.nextAttemptAt.getTime(),
    }));

    return {
      ...summarizeQueue(items, Date.now()),
      workerEnabled: this.enabled,
      workerIntervalMs: this.workerIntervalMs,
      deadLetters: rows.filter((row) => row.status === "DEAD").map(toDto),
      recent: rows.slice(0, 20).map(toDto),
    };
  }

  /**
   * Dead Letter 재시도 — 설정을 고친 뒤 다시 보낸다.
   * 시도 횟수를 0으로 되돌려 재시도 예산을 새로 준다.
   */
  async requeue(ids?: string[]): Promise<{ requeued: number }> {
    const result = await this.prisma.notificationQueue.updateMany({
      where: { status: "DEAD", ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
        deadAt: null,
        lastError: null,
      },
    });
    if (result.count > 0) {
      this.logger.log(`Dead Letter ${result.count}건을 다시 큐에 넣었습니다.`);
    }
    return { requeued: result.count };
  }
}
