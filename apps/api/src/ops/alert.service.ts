import { Injectable, Logger } from "@nestjs/common";
import { reconcileAlerts } from "@acos/core";
import type { AlertState, DetectedAlert } from "@acos/core";
import type { AlertDto, AlertLevelDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/** 같은 경보를 다시 알리기까지의 기본 간격 — 30분 */
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

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
  status: "ACTIVE" | "RESOLVED";
  occurrences: number;
  firstRaisedAt: Date;
  lastRaisedAt: Date;
  notifiedAt: Date | null;
  resolvedAt: Date | null;
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

  constructor(private readonly prisma: PrismaService) {}

  get cooldownMs(): number {
    const raw = Number(process.env.ALERT_COOLDOWN_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COOLDOWN_MS;
  }

  get webhookConfigured(): boolean {
    return Boolean(process.env.ALERT_WEBHOOK_URL?.trim());
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
      status: row.status,
      notifiedAt: row.notifiedAt?.getTime() ?? null,
    }));

    const now = Date.now();
    const decisions = reconcileAlerts(detected, states, {
      cooldownMs: this.cooldownMs,
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

  /** 로그 + (설정 시) 웹훅 — 웹훅 실패는 점검을 실패시키지 않는다 */
  private async deliver(payload: {
    level: AlertLevelDto;
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

    const url = process.env.ALERT_WEBHOOK_URL?.trim();
    if (!url) {
      return;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service: "ai-product-content-os",
          environment: process.env.NODE_ENV ?? "development",
          level: payload.resolved ? "resolved" : payload.level,
          title: payload.title,
          message: payload.message,
          at: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        this.logger.warn(`경보 웹훅 실패 — HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `경보 웹훅 실패 — ${error instanceof Error ? error.message : String(error)}`,
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
}
