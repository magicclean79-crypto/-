import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_ALERT_COOLDOWN_MS,
  matchesFilter,
  planArchive,
  reconcileAlerts,
  resolveArchiveAfterDays,
  resolveCooldowns,
  summarizeHistory,
} from "@acos/core";
import type {
  AlertKind,
  AlertState,
  DetectedAlert,
  HistoryFilter,
} from "@acos/core";
import type {
  AlertArchiveResultDto,
  AlertDto,
  AlertHistoryDto,
  AlertLevelDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationService } from "./notification.service";

export interface AlertDelivery {
  key: string;
  action: string;
  level: AlertLevelDto | null;
  title: string;
}

const LEVEL_TO_DB = { warning: "WARNING", critical: "CRITICAL" } as const;
const LEVEL_FROM_DB = { WARNING: "warning", CRITICAL: "critical" } as const;

interface AlertRow {
  id: string;
  kind: string;
  key: string;
  level: "WARNING" | "CRITICAL";
  title: string;
  message: string;
  status: "ACTIVE" | "RESOLVED" | "ARCHIVED";
  occurrences: number;
  firstRaisedAt: Date;
  lastRaisedAt: Date;
  notifiedAt: Date | null;
  resolvedAt: Date | null;
  archivedAt: Date | null;
}

function toDto(row: AlertRow): AlertDto {
  return {
    id: row.id,
    kind: row.kind as AlertDto["kind"],
    key: row.key,
    level: LEVEL_FROM_DB[row.level],
    title: row.title,
    message: row.message,
    status: row.status,
    occurrences: row.occurrences,
    firstRaisedAt: row.firstRaisedAt.toISOString(),
    lastRaisedAt: row.lastRaisedAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/**
 * Alerting. (TASK-1302, Sprint 13)
 *
 * 감지된 경보를 저장소와 대조해 **무엇을 알릴지** 정하고(core 순수 로직),
 * 알릴 것만 실제로 내보낸다.
 *
 * 전달 채널은 두 가지다:
 * - **로그**(항상) — 어떤 환경에서도 최소한 흔적은 남는다
 * - **웹훅**(`ALERT_WEBHOOK_URL`이 있을 때) — 사람이 보고 있지 않을 때 도달
 *
 * 웹훅 실패가 점검을 실패시키지 않는다 — 알림 채널이 죽었다고 감지까지
 * 멈추면 상황이 더 나빠진다. 대신 실패를 로그로 남긴다.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly queue: NotificationQueueService,
  ) {}

  get cooldownMs(): number {
    const raw = Number(process.env.ALERT_COOLDOWN_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ALERT_COOLDOWN_MS;
  }

  /** 종류별 재알림 간격 (CTO 결정 1302-①) */
  get cooldownByKind(): Record<AlertKind, number> {
    return resolveCooldowns(process.env as Record<string, string | undefined>);
  }

  /** 외부 채널이 하나라도 설정되어 있는가 (주소는 노출하지 않는다) */
  get webhookConfigured(): boolean {
    return this.notifications.channelConfigs().some((config) => config.enabled);
  }

  /**
   * 한 종류(kind)의 경보를 동기화한다.
   *
   * **kind 단위로 처리하는 이유**: 해소 판정은 "이번에 감지되지 않았다"로
   * 하는데, 비용 점검이 돌 때 Provider 경보까지 해소해 버리면 안 된다.
   * 각 점검은 자기가 책임지는 kind만 넘긴다.
   */
  async sync(
    kinds: DetectedAlert["kind"][],
    detected: DetectedAlert[],
  ): Promise<AlertDelivery[]> {
    const rows = (await this.prisma.alert.findMany({
      where: { kind: { in: kinds } },
    })) as AlertRow[];

    const states: AlertState[] = rows.map((row) => ({
      key: row.key,
      level: LEVEL_FROM_DB[row.level],
      // 보관된 경보는 해소된 것으로 본다 — 같은 문제가 다시 나면 새 사건이다
      status: row.status === "ARCHIVED" ? "RESOLVED" : row.status,
      notifiedAt: row.notifiedAt?.getTime() ?? null,
    }));

    const now = Date.now();
    const decisions = reconcileAlerts(detected, states, {
      cooldownMs: this.cooldownMs,
      cooldownByKind: this.cooldownByKind,
      now,
    });

    const deliveries: AlertDelivery[] = [];

    for (const decision of decisions) {
      if (decision.action === "resolve") {
        const row = rows.find((entry) => entry.key === decision.key);
        await this.prisma.alert.update({
          where: { key: decision.key },
          data: { status: "RESOLVED", resolvedAt: new Date(now) },
        });
        await this.deliver({
          level: "warning",
          kind: row?.kind ?? "unknown",
          key: decision.key,
          title: `해소 — ${row?.title ?? decision.key}`,
          message: decision.reason,
          resolved: true,
        });
        deliveries.push({
          key: decision.key,
          action: decision.action,
          level: null,
          title: `해소 — ${row?.title ?? decision.key}`,
        });
        continue;
      }

      const alert = decision.alert!;
      const existing = rows.find((entry) => entry.key === alert.key);
      await this.prisma.alert.upsert({
        where: { key: alert.key },
        create: {
          kind: alert.kind,
          key: alert.key,
          level: LEVEL_TO_DB[alert.level],
          title: alert.title,
          message: alert.message,
          status: "ACTIVE",
          notifiedAt: decision.notify ? new Date(now) : null,
        },
        update: {
          level: LEVEL_TO_DB[alert.level],
          title: alert.title,
          message: alert.message,
          status: "ACTIVE",
          resolvedAt: null,
          archivedAt: null,
          lastRaisedAt: new Date(now),
          // 해소됐다가 재발한 경우는 새 사건이므로 횟수를 다시 센다
          occurrences:
            existing && existing.status === "ACTIVE"
              ? existing.occurrences + 1
              : 1,
          ...(decision.notify ? { notifiedAt: new Date(now) } : {}),
        },
      });

      if (!decision.notify) {
        continue;
      }
      await this.deliver({
        level: alert.level,
        kind: alert.kind,
        key: alert.key,
        title: alert.title,
        message: alert.message,
        resolved: false,
      });
      deliveries.push({
        key: alert.key,
        action: decision.action,
        level: alert.level,
        title: alert.title,
      });
    }

    return deliveries;
  }

  /**
   * 로그(항상) + Notification Center(채널별 재시도).
   * 전송 실패가 점검을 실패시키지 않는다 — 알림 채널이 죽었다고 감지까지
   * 멈추면 상황이 더 나빠진다.
   */
  private async deliver(payload: {
    level: AlertLevelDto;
    kind: string;
    key: string;
    title: string;
    message: string;
    resolved: boolean;
  }): Promise<void> {
    const line = `[${payload.resolved ? "RESOLVED" : payload.level.toUpperCase()}] ${payload.title} — ${payload.message}`;
    if (payload.resolved || payload.level === "warning") {
      this.logger.warn(line);
    } else {
      this.logger.error(line);
    }

    try {
      // 큐에 담고 워커가 보낸다 (TASK-1501, CTO 결정 1401-②) —
      // 인스턴스가 재시작해도 전송이 사라지지 않는다
      await this.queue.enqueue({
        level: payload.resolved ? "resolved" : payload.level,
        kind: payload.kind,
        key: payload.key,
        title: payload.title,
        message: payload.message,
        at: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? "development",
        url: this.notifications.alertUrl(),
      });
    } catch (error) {
      this.logger.warn(
        `알림 적재 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async active(): Promise<AlertDto[]> {
    const rows = (await this.prisma.alert.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ level: "desc" }, { lastRaisedAt: "desc" }],
    })) as AlertRow[];
    return rows.map(toDto);
  }

  async recent(limit = 20): Promise<AlertDto[]> {
    const rows = (await this.prisma.alert.findMany({
      orderBy: { lastRaisedAt: "desc" },
      take: limit,
    })) as AlertRow[];
    return rows.map(toDto);
  }

  /**
   * Alert History (TASK-1401) — 보관된 것까지 포함한 전체 이력과 요약.
   * 필터는 저장소에 넘기고, core의 순수 필터로 한 번 더 거른다
   * (저장소가 지원하지 않는 조합도 같은 규칙으로 동작하게).
   */
  async history(
    filter: HistoryFilter & { limit?: number } = {},
  ): Promise<AlertHistoryDto> {
    const rows = (await this.prisma.alert.findMany({
      orderBy: { lastRaisedAt: "desc" },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 500),
      ...(filter.kind ? { where: { kind: filter.kind } } : {}),
    })) as AlertRow[];

    const entries = rows.map((row) => ({
      row,
      entry: {
        key: row.key,
        kind: row.kind,
        level: LEVEL_FROM_DB[row.level],
        status: row.status,
        firstRaisedAt: row.firstRaisedAt.getTime(),
        lastRaisedAt: row.lastRaisedAt.getTime(),
        resolvedAt: row.resolvedAt?.getTime() ?? null,
        occurrences: row.occurrences,
      },
    })).filter(({ entry }) => matchesFilter(entry, filter));

    return {
      entries: entries.map(({ row }) => toDto(row)),
      summary: summarizeHistory(entries.map(({ entry }) => entry)),
      archiveAfterDays: this.archiveAfterDays,
      checkedAt: new Date().toISOString(),
    };
  }

  get archiveAfterDays(): number {
    return resolveArchiveAfterDays(
      process.env as Record<string, string | undefined>,
    );
  }

  /**
   * Alert Archive (TASK-1401, CTO 결정 1302-④).
   * **삭제하지 않는다** — 해소 후 유예(기본 90일)가 지난 경보를 `ARCHIVED`로
   * 옮겨 현황에서 비켜 두되 이력에는 남긴다.
   */
  async archive(): Promise<AlertArchiveResultDto> {
    const afterDays = this.archiveAfterDays;
    const rows = (await this.prisma.alert.findMany({
      where: { status: "RESOLVED" },
    })) as AlertRow[];

    const plan = planArchive(
      rows.map((row) => ({
        key: row.key,
        status: row.status,
        resolvedAt: row.resolvedAt?.getTime() ?? null,
      })),
      { afterDays, now: Date.now() },
    );

    if (plan.archive.length > 0) {
      await this.prisma.alert.updateMany({
        where: { key: { in: plan.archive } },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      this.logger.log(
        `경보 ${plan.archive.length}건을 보관했습니다 (해소 후 ${afterDays}일 경과) — 삭제하지 않습니다.`,
      );
    }

    return {
      archived: plan.archive.length,
      keys: plan.archive,
      afterDays,
      cutoff: new Date(plan.cutoff).toISOString(),
      checked: plan.checked,
    };
  }
}
