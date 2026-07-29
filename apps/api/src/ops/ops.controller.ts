import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SCHEDULED_JOBS, summarizeAlerts } from "@acos/core";
import type { ScheduledJob } from "@acos/core";
import type {
  AlertArchiveResultDto,
  AlertBoardDto,
  AlertHistoryDto,
  CheckRunResultDto,
  NotificationDeliveryDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import { AlertService } from "./alert.service";
import { NotificationService } from "./notification.service";
import { ScheduledChecksService } from "./scheduled-checks.service";

/**
 * 운영 자동화·경보 API. (TASK-1302, Sprint 13)
 *
 * 조회·실행 모두 **ADMIN 전용**이다 — 경보 본문에는 예산 지출·Provider
 * 구성·설정 오류가 그대로 드러나고(결정 1201-⑤와 같은 판단), 수동 실행은
 * 실제 점검을 돌린다.
 */
@Controller("ops")
@UseGuards(AuthGuard)
@RequireRole("ADMIN")
export class OpsController {
  constructor(
    private readonly alerts: AlertService,
    private readonly checks: ScheduledChecksService,
    private readonly notifications: NotificationService,
  ) {}

  /** 경보 현황 + 예약 점검 구성·마지막 결과 */
  @Get("alerts")
  async board(@Query("limit") limit?: string): Promise<AlertBoardDto> {
    const [active, recent, schedules, deliveries, coordination] =
      await Promise.all([
        this.alerts.active(),
        this.alerts.recent(Number(limit) || 20),
        this.checks.status(),
        this.notifications.deliveries(10),
        this.checks.coordination(),
      ]);
    const summary = summarizeAlerts(active);
    return {
      ok: summary.ok,
      summary: {
        total: summary.total,
        critical: summary.critical,
        warning: summary.warning,
      },
      active,
      recent,
      schedules,
      // URL 자체는 노출하지 않는다 — 웹훅 주소도 비밀이다
      webhookConfigured: this.alerts.webhookConfigured,
      cooldownMs: this.alerts.cooldownMs,
      cooldownByKind: this.alerts.cooldownByKind,
      channels: this.notifications.status(),
      deliveries,
      coordination,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Alert History (TASK-1401) — 보관된 것까지 포함한 전체 이력과 요약.
   * 평균 해소 시간을 함께 낸다 — 경보가 많은 것보다 **오래 방치되는 것**이
   * 더 나쁜 신호다.
   */
  @Get("alerts/history")
  async history(
    @Query("kind") kind?: string,
    @Query("level") level?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<AlertHistoryDto> {
    return this.alerts.history({
      kind,
      level: level === "warning" || level === "critical" ? level : undefined,
      status:
        status === "ACTIVE" || status === "RESOLVED" || status === "ARCHIVED"
          ? status
          : undefined,
      limit: Number(limit) || undefined,
    });
  }

  /**
   * Alert Archive (TASK-1401, CTO 결정 1302-④) — **삭제하지 않는다**.
   * 해소 후 유예(기본 90일)가 지난 경보를 보관으로 옮긴다.
   */
  @Post("alerts/archive")
  @HttpCode(200)
  async archive(): Promise<AlertArchiveResultDto> {
    return this.alerts.archive();
  }

  /** 최근 알림 전송 시도 — "왜 아무도 못 받았는가"를 추적한다 */
  @Get("notifications")
  async deliveries(
    @Query("limit") limit?: string,
  ): Promise<NotificationDeliveryDto[]> {
    return this.notifications.deliveries(Number(limit) || 20);
  }

  /**
   * 알림 채널 시험 — **실제로 전송한다**. 설정 직후 확인용이라
   * 눌러야만 실행되고, 본문에 "실제 문제가 아님"을 명시한다.
   */
  @Post("notifications/test")
  @HttpCode(200)
  async testNotification(): Promise<{
    sent: number;
    results: { ok: boolean; attempts: number; status: number | null; error: string | null }[];
  }> {
    const results = await this.notifications.test("warning");
    return { sent: results.length, results };
  }

  /**
   * 점검 수동 실행 — `?job=`으로 하나만, 없으면 전부.
   * 예약을 기다리지 않고 지금 상태를 확인해야 할 때 쓴다(배포 직후 등).
   */
  @Post("checks/run")
  @HttpCode(200)
  async run(@Query("job") job?: string): Promise<CheckRunResultDto[]> {
    if (!job) {
      return this.checks.runAll("manual");
    }
    if (!(SCHEDULED_JOBS as readonly string[]).includes(job)) {
      throw new BadRequestException(
        `지원하지 않는 점검입니다: ${job} (${SCHEDULED_JOBS.join(" / ")})`,
      );
    }
    return [await this.checks.run(job as ScheduledJob, "manual")];
  }
}
