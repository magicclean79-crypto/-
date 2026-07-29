import { Injectable, Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";
import {
  CHANNEL_ENV,
  decideRetry,
  DEFAULT_RETRY_POLICY,
  emailBody,
  NOTIFICATION_CHANNELS,
  resolveChannelPolicy,
  selectChannels,
  slackBody,
  webhookBody,
} from "@acos/core";
import type {
  ChannelConfig,
  NotificationChannel,
  NotificationLevel,
  NotificationPayload,
  RetryPolicy,
} from "@acos/core";
import type { NotificationChannelStatusDto } from "@acos/shared";

import { PrismaService } from "../prisma/prisma.service";

interface SendResult {
  ok: boolean;
  attempts: number;
  status: number | null;
  error: string | null;
}

/**
 * Notification Center. (TASK-1401, Sprint 14)
 *
 * TASK-1302의 알림은 단일 웹훅·재시도 없음이었다 — 한 번 실패하면
 * **아무도 모르는 채로 끝났다**. 이제 채널이 셋이고, 재시도하고,
 * 시도 결과를 남긴다.
 *
 * 설계 원칙:
 * - **채널 하나가 죽어도 나머지는 보낸다** — 알림 체계가 단일 장애점이 되면
 *   안 된다.
 * - **되돌릴 수 없는 실패는 재시도하지 않는다**(4xx) — 같은 요청은 같은 답을
 *   받는다.
 * - **전송 실패도 기록한다** — "왜 아무도 못 받았는가"를 나중에 추적할 수
 *   있어야 한다.
 * - 전송 실패가 경보 감지를 실패시키지 않는다 (TASK-1302에서 정한 태도 유지).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private mailer: Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 테스트에서 대기 없이 돌리기 위한 훅 */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  /** 재시도 정책 (큐 워커와 공유) */
  get retryPolicy(): RetryPolicy {
    return this.policy;
  }

  private get policy(): RetryPolicy {
    const attempts = Number(process.env.ALERT_RETRY_MAX_ATTEMPTS);
    return {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts:
        Number.isFinite(attempts) && attempts > 0
          ? Math.round(attempts)
          : DEFAULT_RETRY_POLICY.maxAttempts,
    };
  }

  /**
   * 채널 구성 — 주소가 설정된 채널만 켜지고, 정책은 core가 해석한다.
   * 기본값은 **CTO 결정 1401-④의 공식 정책**(Slack Warning 이상 /
   * Email Critical 이상 / Webhook Warning 이상 / 해소 포함)이다.
   * 주소(웹훅 URL·SMTP·수신자)는 어떤 응답에도 담지 않는다.
   */
  channelConfigs(): ChannelConfig[] {
    return resolveChannelPolicy(process.env as Record<string, string | undefined>, {
      slack: Boolean(process.env.ALERT_SLACK_WEBHOOK_URL?.trim()),
      email:
        Boolean(process.env.ALERT_EMAIL_TO?.trim()) &&
        Boolean(process.env.SMTP_HOST?.trim()),
      webhook: Boolean(process.env.ALERT_WEBHOOK_URL?.trim()),
    });
  }

  /** 채널 현황 (주소는 노출하지 않는다) */
  status(): NotificationChannelStatusDto[] {
    return this.channelConfigs().map((config) => ({
      channel: config.channel,
      enabled: config.enabled,
      minLevel: config.minLevel,
      resolved: config.resolved,
      env: CHANNEL_ENV[config.channel].target,
    }));
  }

  /**
   * 모든 대상 채널로 보낸다.
   * 한 채널이 실패해도 나머지는 계속 보내고, 결과를 전부 기록한다.
   */
  async notify(payload: NotificationPayload): Promise<SendResult[]> {
    const configs = this.channelConfigs();
    const targets = selectChannels(configs, payload.level);

    if (targets.length === 0) {
      // 채널이 하나도 없으면 로그가 유일한 흔적이다 — 그 사실을 남긴다
      this.logger.warn(
        `[${payload.level}] ${payload.title} — 전달 채널이 없어 로그로만 남깁니다.`,
      );
      return [];
    }

    const results: SendResult[] = [];
    for (const channel of targets) {
      const result = await this.sendWithRetry(channel, payload);
      results.push(result);
      await this.record(channel, payload, result);
    }
    return results;
  }

  /** 채널 1개 전송 — 재시도 포함 */
  private async sendWithRetry(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<SendResult> {
    const policy = this.policy;
    let attempt = 0;
    let lastStatus: number | null = null;
    let lastError: string | null = null;

    while (attempt < policy.maxAttempts) {
      attempt += 1;
      try {
        const status = await this.send(channel, payload);
        if (status === null || (status >= 200 && status < 300)) {
          return { ok: true, attempts: attempt, status, error: null };
        }
        lastStatus = status;
        lastError = `HTTP ${status}`;
      } catch (error) {
        lastStatus = null;
        lastError = error instanceof Error ? error.message : String(error);
      }

      const decision = decideRetry(attempt, lastStatus, policy);
      if (!decision.retry) {
        this.logger.warn(
          `${channel} 알림 전송 실패 (${attempt}회) — ${lastError} · ${decision.reason}`,
        );
        break;
      }
      await this.wait(decision.delayMs);
    }

    return { ok: false, attempts: attempt, status: lastStatus, error: lastError };
  }

  /**
   * 채널 1회 전송 (재시도 없음) — 큐 워커가 재시도를 관리한다.
   * 예외를 던지지 않고 결과로 돌려준다.
   */
  async sendOnce(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<{ ok: boolean; status: number | null; error: string | null }> {
    try {
      const status = await this.send(channel, payload);
      if (status === null || (status >= 200 && status < 300)) {
        return { ok: true, status, error: null };
      }
      return { ok: false, status, error: `HTTP ${status}` };
    } catch (error) {
      return {
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 실제 전송 — 성공 시 상태 코드(메일은 null) */
  private async send(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<number | null> {
    if (channel === "slack") {
      const url = process.env.ALERT_SLACK_WEBHOOK_URL!.trim();
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(slackBody(payload)),
      });
      return response.status;
    }

    if (channel === "webhook") {
      const url = process.env.ALERT_WEBHOOK_URL!.trim();
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(webhookBody(payload)),
      });
      return response.status;
    }

    const body = emailBody(payload);
    await this.transporter().sendMail({
      from: process.env.ALERT_EMAIL_FROM ?? "acos@localhost",
      to: process.env.ALERT_EMAIL_TO!.trim(),
      subject: body.subject,
      text: body.text,
    });
    return null; // SMTP는 상태 코드가 없다 — 예외 여부로 판정한다
  }

  private transporter(): Transporter {
    if (!this.mailer) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.mailer = createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        ...(process.env.SMTP_USER
          ? {
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD ?? "",
              },
            }
          : {}),
      });
    }
    return this.mailer;
  }

  async record(
    channel: NotificationChannel,
    payload: NotificationPayload,
    result: SendResult,
  ): Promise<void> {
    try {
      await this.prisma.notificationDelivery.create({
        data: {
          alertKey: payload.key,
          channel,
          level: payload.level,
          ok: result.ok,
          attempts: result.attempts,
          status: result.status,
          error: result.error,
        },
      });
    } catch (error) {
      // 이력 기록 실패가 알림을 실패시키지는 않는다
      this.logger.warn(
        `알림 이력 기록 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 최근 전송 이력 (실패 추적용) */
  async deliveries(limit = 20): Promise<
    {
      id: string;
      alertKey: string;
      channel: string;
      level: string;
      ok: boolean;
      attempts: number;
      status: number | null;
      error: string | null;
      createdAt: string;
    }[]
  > {
    const rows = await this.prisma.notificationDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => ({
      id: row.id,
      alertKey: row.alertKey,
      channel: row.channel,
      level: row.level,
      ok: row.ok,
      attempts: row.attempts,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** 채널 연결 시험 — 운영자가 설정 직후 확인용 (실제 전송) */
  async test(level: NotificationLevel = "warning"): Promise<SendResult[]> {
    return this.notify({
      level,
      kind: "test",
      key: "test:notification",
      title: "알림 채널 시험",
      message:
        "이 메시지가 보이면 채널이 정상입니다 — 실제 문제가 발생한 것은 아닙니다.",
      at: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? "development",
      url: this.alertUrl(),
    });
  }

  alertUrl(): string | null {
    const web = process.env.WEB_URL?.trim();
    return web ? `${web.replace(/\/$/, "")}/admin/production` : null;
  }

  /** 선언된 채널 이름 (표시·검증용) */
  static readonly channels = NOTIFICATION_CHANNELS;
}
