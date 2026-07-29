import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  buildDisasterRecoveryChecklist,
  DRILL_TRIGGERS,
  judgeRecordedRemoteIntegrity,
  judgeStorageProtection,
  judgeStorageStandard,
  resolveSchedules,
  SCHEDULED_JOBS,
  summarizeAlerts,
  summarizeDisasterRecovery,
} from "@acos/core";
import type {
  DrillTrigger as ScheduledDrillTrigger,
  ProtectionState,
  ScheduledJob,
} from "@acos/core";
import type {
  DrStatusDto,
  AlertArchiveResultDto,
  AlertBoardDto,
  AlertHistoryDto,
  CheckRunResultDto,
  NotificationDeliveryDto,
  NotificationQueueStatusDto,
  DrillRequirementDto,
  OperationsReadinessDto,
  RecoveryDrillDto,
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
import { RecoveryDrillService } from "./recovery-drill.service";
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
    private readonly drills: RecoveryDrillService,
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
      backupProtection,
      drill,
      drillHistory,
      requirements,
    ] = await Promise.all([
      this.backups.health(),
      this.backups.backupHistory(10),
      this.backups.restoreHistory(10),
      this.notifications.verifySmtp(),
      this.locks.ping(),
      this.checkDatabase(),
      this.checkStorage(),
      this.describeStorageProtection(),
      this.describeStorageProtection(true),
      this.drills.health(),
      this.drills.history(10),
      this.drills.requirements(10),
    ]);

    // 조회는 원격에서 내려받지 않는다 — **기록된 대조 결과**를 읽는다.
    // 주 1회 예약(CTO 결정 2001-②)이 실제 내려받기를 담당한다.
    const remoteVerifyIntervalMs = this.backups.remoteVerifyIntervalMs;
    const remoteVerifyScheduled =
      resolveSchedules(process.env as Record<string, string | undefined>).find(
        (entry) => entry.job === "remote-verify",
      )?.enabled ?? false;
    const remoteIntegrity = judgeRecordedRemoteIntegrity(health.remoteRecord, {
      now: Date.now(),
      intervalMs: remoteVerifyIntervalMs,
    });

    // 이미지 저장소 보호 상태 (CTO 결정 1601-④·1701-③) — 앱은 이미지를
    // 백업하지 않는다. 운영에서는 Versioning이 필수, Replication은 권장이다.
    const production = process.env.NODE_ENV === "production";
    const storageProtection = judgeStorageProtection({
      ...protection,
      production,
      label: "이미지 저장소",
    });
    // 백업 버킷도 같은 규칙으로 판정한다 (CTO 결정 1801-③)
    const backupBucketProtection = judgeStorageProtection({
      ...backupProtection,
      production,
      label: "백업 버킷",
    });
    // 운영 저장소 표준 (CTO 결정 1901-③)
    const storageStandard = judgeStorageStandard(
      process.env.S3_ENDPOINT,
      production,
    );
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
        drill: { status: drill.status, detail: drill.detail },
        backupBucketProtection,
        backupPerformance: {
          status: health.performance.status,
          detail: health.performance.detail,
        },
        backupChain: {
          status: health.chain.status,
          detail: health.chain.detail,
        },
        remoteIntegrity: {
          status: remoteIntegrity.status,
          detail: remoteIntegrity.detail,
        },
        storageStandard: {
          status: storageStandard.status,
          detail: storageStandard.detail,
        },
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
        drill: {
          status: drill.status,
          detail: drill.detail,
          ageMs: drill.ageMs,
          dueAt: drill.dueAt === null ? null : new Date(drill.dueAt).toISOString(),
          overdueDays: drill.overdueDays,
          intervalDays: Math.round(drill.intervalMs / (24 * 60 * 60 * 1000)),
          history: drillHistory,
          pendingTriggers: drill.pendingTriggers,
          requirements,
          // 재기동 후 자동 등록을 확인할 수 있어야 한다 (CTO 결정 2001-④)
          autoRegistration: this.drills.lastAutoRegistration(),
        },
        backupBucket: {
          name: this.storage.backupBucket,
          // 이미지 버킷과 같으면 한 쪽이 사라질 때 둘 다 사라진다 (결정 1701-②)
          separated: this.storage.backupBucket !== this.storage.bucket,
          protection: { ...backupBucketProtection, ...backupProtection },
        },
        performance: health.performance,
        backupIntegrity: {
          chain: {
            status: health.chain.status,
            detail: health.chain.detail,
            expected: health.chain.expected,
            actual: health.chain.actual,
            longestGapMs: health.chain.longestGapMs,
            windowMs: health.chainWindow.windowMs,
            windowSource: health.chainWindow.source,
            windowDetail: health.chainWindow.detail,
          },
          remote: {
            status: remoteIntegrity.status,
            detail: remoteIntegrity.detail,
            verdict: remoteIntegrity.verdict,
            checkedAt:
              health.remoteRecord === null
                ? null
                : new Date(health.remoteRecord.checkedAt).toISOString(),
            intervalMs: remoteVerifyIntervalMs,
            scheduled: remoteVerifyScheduled,
          },
          scale: {
            status: health.scale.status,
            detail: health.scale.detail,
            bytes: health.scale.bytes,
            reachedMilestone: health.scale.reachedMilestone,
            nextMilestone: health.scale.nextMilestone,
          },
          storageStandard,
        },
      },
      checkedAt: new Date().toISOString(),
    };
  }

  /** 저장소가 알려 주지 않으면 unknown으로 남긴다 — 모르는 것을 통과로 세지 않는다 */
  private async describeStorageProtection(backupBucket = false): Promise<{
    versioning: ProtectionState;
    replication: ProtectionState;
  }> {
    try {
      return backupBucket
        ? await this.storage.describeBackupProtection()
        : await this.storage.describeProtection();
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

  /**
   * 복구 리허설 기록 (TASK-1801, CTO 결정 1701-⑤).
   *
   * 리허설 자체는 사람이 한다 — 여기서는 **한 사실을 남긴다**.
   * 실패한 리허설도 기록한다: 절차가 깨졌다는 것을 사고 전에 알아낸 것이다.
   */
  @Post("drills")
  @HttpCode(201)
  async recordDrill(
    @Body()
    body: {
      ok?: boolean;
      performedBy?: string;
      durationMs?: number;
      findings?: string;
      notes?: string;
    },
  ): Promise<RecoveryDrillDto> {
    if (typeof body?.ok !== "boolean") {
      throw new BadRequestException(
        "ok는 true/false여야 합니다 — 리허설이 성공했는지 실패했는지가 기록의 핵심입니다.",
      );
    }
    const performedBy = body.performedBy?.trim();
    if (!performedBy) {
      throw new BadRequestException(
        "performedBy는 필수입니다 — 누가 확인했는지 남지 않으면 기록이 아닙니다.",
      );
    }
    return this.drills.record({
      ok: body.ok,
      performedBy,
      durationMs:
        typeof body.durationMs === "number" && body.durationMs >= 0
          ? Math.round(body.durationMs)
          : null,
      findings: body.findings?.trim() || null,
      notes: body.notes?.trim() || null,
    });
  }

  /** 복구 리허설 이력 */
  @Get("drills")
  async drillHistory(@Query("limit") limit?: string): Promise<RecoveryDrillDto[]> {
    return this.drills.history(Number(limit) || 20);
  }

  /**
   * 변경 후 추가 리허설 요구 등록 (TASK-1901, CTO 결정 1801-⑤).
   *
   * **달력이 아니라 변경이 리허설을 부른다** — DR 절차·DB·백업 방식이 크게
   * 바뀌면 마지막 리허설이 검증한 것은 지금의 시스템이 아니다.
   */
  @Post("drills/require")
  @HttpCode(201)
  async requireDrill(
    @Body() body: { trigger?: string; description?: string; registeredBy?: string },
  ): Promise<DrillRequirementDto> {
    const trigger = body?.trigger?.trim() as ScheduledDrillTrigger | undefined;
    if (!trigger || !(DRILL_TRIGGERS as readonly string[]).includes(trigger)) {
      throw new BadRequestException(
        `trigger는 ${DRILL_TRIGGERS.join(" | ")} 중 하나여야 합니다.`,
      );
    }
    const description = body.description?.trim();
    if (!description) {
      throw new BadRequestException(
        "description은 필수입니다 — 무엇이 바뀌었는지 남지 않으면 다음 리허설이 무엇을 확인해야 할지 알 수 없습니다.",
      );
    }
    const registeredBy = body.registeredBy?.trim();
    if (!registeredBy) {
      throw new BadRequestException("registeredBy는 필수입니다.");
    }
    return this.drills.requireDrill({ trigger, description, registeredBy });
  }

  /**
   * 요구 취소 (CTO 결정 1901-②) — **삭제는 금지한다.**
   * 왜 취소했는지가 다음 판단의 근거가 되므로 사유를 필수로 받는다.
   */
  @Post("drills/requirements/:id/cancel")
  @HttpCode(200)
  async cancelRequirement(
    @Param("id") id: string,
    @Body() body: { cancelledBy?: string; reason?: string },
  ): Promise<DrillRequirementDto> {
    const cancelledBy = body?.cancelledBy?.trim();
    const reason = body?.reason?.trim();
    if (!cancelledBy || !reason) {
      throw new BadRequestException(
        "cancelledBy와 reason은 필수입니다 — 왜 취소했는지가 남지 않으면 기록이 아닙니다.",
      );
    }
    return this.drills.cancelRequirement(id, { cancelledBy, reason });
  }

  /**
   * 원격 사본 무결성 검증 (TASK-2001).
   * **내려받아 대조하므로 전송 비용이 든다** — 눌러야만 실행한다.
   */
  @Post("backup/verify-remote")
  @HttpCode(200)
  async verifyRemote() {
    return this.backups.verifyRemoteCopy();
  }

  /** 변경 사건 목록 */
  @Get("drills/requirements")
  async drillRequirements(
    @Query("limit") limit?: string,
  ): Promise<DrillRequirementDto[]> {
    return this.drills.requirements(Number(limit) || 20);
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
