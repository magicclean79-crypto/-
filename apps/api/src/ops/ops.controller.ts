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
import type { AlertBoardDto, CheckRunResultDto } from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import { AlertService } from "./alert.service";
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
  ) {}

  /** 경보 현황 + 예약 점검 구성·마지막 결과 */
  @Get("alerts")
  async board(@Query("limit") limit?: string): Promise<AlertBoardDto> {
    const [active, recent, schedules] = await Promise.all([
      this.alerts.active(),
      this.alerts.recent(Number(limit) || 20),
      this.checks.status(),
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
      checkedAt: new Date().toISOString(),
    };
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
