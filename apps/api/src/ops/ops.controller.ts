import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  buildDisasterRecoveryChecklist,
  judgeStorageProtection,
  SCHEDULED_JOBS,
  summarizeAlerts,
  summarizeDisasterRecovery,
} from "@acos/core";
import type { ProtectionState, ScheduledJob } from "@acos/core";
import type {
  DrStatusDto,
  AlertArchiveResultDto,
  AlertBoardDto,
  AlertHistoryDto,
  CheckRunResultDto,
  NotificationDeliveryDto,
  NotificationQueueStatusDto,
  OperationsReadinessDto,
  SmtpValidationDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AlertService } from "./alert.service";
import { BackupService } from "./backup.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationQueueService } from "./notification-queue.service";
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
    private readonly queue: NotificationQueueService,
    private readonly backups: BackupService,
    private readonly locks: DistributedLockService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Operations Dashboard · Disaster Recovery Checklist (TASK-1601).
   *
   * 배포 체크리스트(1202)와 목적이 다르다 — 그쪽은 "지금 배포해도 되는가",
   * 이쪽은 **"지금 무너지면 되살릴 수 있는가"** 다.
   */
  @Get("readiness")
  async readiness(): Promise<OperationsReadinessDto> {
    const [
      health,
      backupHistory,
      restoreHistory,
      smtp,
      redis,
      database,
      storage,
      protection,
    ] = await Promise.all([
      this.backups.health(),
      this.backups.backupHistory(10),
      this.backups.restoreHistory(10),
      this.notifications.verifySmtp(),
      this.locks.ping(),
      this.checkDatabase(),
      this.checkStorage(),
      this.describeStorageProtection(),
    ]);

    // 이미지 저장소 보호 상태 (CTO 결정 1601-④) — 앱은 이미지를 백업하지 않는다
    const storageProtection = judgeStorageProtection(protection);
    const targetSafety = this.backups.restoreTargetSafety;
    const restoreTarget = {
      status: (targetSafety.verdict === "same-as-production"
        ? "fail"
        : targetSafety.verdict === "not-configured"
          ? "warn"
          : "pass") as DrStatusDto,
      detail: targetSafety.detail,
    };

    const channels = this.notifications
      .channelConfigs()
      .filter((config) => config.enabled).length;

    const checklist = buildDisasterRecoveryChecklist({
      backup: health.backup,
      restore: health.restore,
      database,
      storage,
      // Redis를 안 쓰는 구성이면 항목 자체를 두지 않는다
      lock: this.locks.distributed
        ? { ok: redis.ok, detail: redis.detail }
        : null,
      notificationChannels: channels,
      runbookPath: "docs/operations/disaster-recovery.md",
      enterprise: {
        integrity: health.integrity,
        offsite: health.offsite,
        storageProtection,
        objectives: {
          status: health.objectives.status,
          detail: health.objectives.detail,
        },
        restoreTarget,
      },
    });
    const summary = summarizeDisasterRecovery(checklist);
    const unhealthySince = this.locks.unhealthySince;

    return {
      recoverable: summary.recoverable,
      summary: {
        pass: summary.pass,
        fail: summary.fail,
        warn: summary.warn,
        manual: summary.manual,
      },
      checklist,
      backup: {
        verdict: health.backup.verdict,
        message: health.backup.message,
        ageMs: health.backup.ageMs,
        sizeBytes: health.backup.sizeBytes,
        history: backupHistory,
        directory: this.backups.describeDirectory(),
        retentionDays: this.backups.retentionDays,
      },
      restore: {
        verdict: health.restore.verdict,
        message: health.restore.message,
        ageMs: health.restore.ageMs,
        tables: health.restore.tables,
        history: restoreHistory,
        configured: this.backups.restoreTarget !== null,
      },
      smtp,
      redis: {
        configured: this.locks.distributed,
        ok: redis.ok,
        detail: redis.detail,
        latencyMs: redis.latencyMs,
        unhealthySince:
          unhealthySince === null ? null : new Date(unhealthySince).toISOString(),
        outageThresholdMs: this.checks.lockOutageThresholdMs,
      },
      enterprise: {
        integrity: health.integrity,
        offsite: {
          ...health.offsite,
          configured: this.backups.offsiteEnabled,
          copies: backupHistory.filter((entry) => entry.offsite).length,
        },
        storageProtection: { ...storageProtection, ...protection },
        objectives: health.objectives,
        restoreTarget: { ...restoreTarget, verdict: targetSafety.verdict },
      },
      checkedAt: new Date().toISOString(),
    };
  }

  /** 저장소가 알려 주지 않으면 unknown으로 남긴다 — 모르는 것을 통과로 세지 않는다 */
  private async describeStorageProtection(): Promise<{
    versioning: ProtectionState;
    replication: ProtectionState;
  }> {
    try {
      return await this.storage.describeProtection();
    } catch {
      return { versioning: "unknown", replication: "unknown" };
    }
  }

  /** SMTP 연결·인증 검증 — **메일은 보내지 않는다** */
  @Post("notifications/verify-smtp")
  @HttpCode(200)
  async verifySmtp(): Promise<SmtpValidationDto> {
    return this.notifications.verifySmtp();
  }

  /** 백업 수동 실행 */
  @Post("backup/run")
  @HttpCode(200)
  async runBackup() {
    return this.backups.backup("manual");
  }

  /** 복원 검증 수동 실행 — 운영 DB가 아니라 별도 DB에 복원한다 */
  @Post("backup/verify-restore")
  @HttpCode(200)
  async runRestoreVerify() {
    return this.backups.verifyRestore("manual");
  }

  private async checkDatabase(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, detail: "연결 정상" };
    } catch (error) {
      return {
        ok: false,
        detail: `연결 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async checkStorage(): Promise<{ ok: boolean; detail: string }> {
    try {
      const detail = await this.storage.check();
      return { ok: true, detail };
    } catch (error) {
      return {
        ok: false,
        detail: `접근 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

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

  /**
   * 알림 큐 현황 (TASK-1501, CTO 결정 1401-②) — 대기·성공·**Dead Letter**.
   * Dead Letter는 지우지 않는다 — 무엇이 전달되지 못했는지 남아 있어야
   * 사람이 고친 뒤 다시 보낼 수 있다.
   */
  @Get("notifications/queue")
  async queueStatus(): Promise<NotificationQueueStatusDto> {
    return this.queue.status();
  }

  /** 큐를 지금 비운다 — 예약 워커를 기다리지 않고 확인할 때 */
  @Post("notifications/queue/drain")
  @HttpCode(200)
  async drainQueue(): Promise<{
    processed: number;
    sent: number;
    retried: number;
    dead: number;
    skipped: string | null;
  }> {
    // 수동 실행은 잠금을 요구하지 않는다 — 사람이 지금 확인하려는 것이다
    return this.queue.drain({ force: true });
  }

  /**
   * Dead Letter 재시도 — 설정을 고친 뒤 다시 보낸다.
   * `ids`가 없으면 전부.
   */
  @Post("notifications/queue/requeue")
  @HttpCode(200)
  async requeue(@Body() body?: { ids?: string[] }): Promise<{ requeued: number }> {
    return this.queue.requeue(body?.ids);
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
