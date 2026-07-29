import { Injectable, Logger } from "@nestjs/common";
import {
  buildDisasterRecoveryChecklist,
  judgeChainWindow,
  judgeRecordedRemoteIntegrity,
  judgeStorageProtection,
  judgeStorageStandard,
  resolveSchedules,
  summarizeDisasterRecovery,
} from "@acos/core";
import type { ProtectionState } from "@acos/core";
import type { DrItemDto, DrStatusDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { BackupService } from "./backup.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationService } from "./notification.service";
import { RecoveryDrillService } from "./recovery-drill.service";

/**
 * Recovery Evaluation. (TASK-2401, Sprint 24 — CTO 결정 2301-①)
 *
 * **복구 판정의 단일 원천(Single Source of Truth)이다.**
 *
 * 이전에는 두 곳이 각자 판정했다: `/ops/readiness`는 체크리스트를 조립해
 * `recoverable`을 계산하고, 배포 체크리스트(`/health/ready`)는 순환 의존을
 * 피하려고 **백업·복원 이력 개수**로 대신 판정했다. 두 판정은 느슨하게만
 * 일치했고, 그것은 곧 **한 화면은 복구 가능이라 하고 다른 화면은 아니라고
 * 하는** 상태를 허용한다는 뜻이다.
 *
 * 그래서 조립을 이 계층으로 끌어내렸다. 두 소비자가 **같은 함수를 부른다.**
 * 순환 의존은 모듈 방향으로 푼다 — Health가 Ops를 가져오고, 그 반대는 없다.
 */
@Injectable()
export class RecoveryEvaluationService {
  private readonly logger = new Logger(RecoveryEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly backups: BackupService,
    private readonly drills: RecoveryDrillService,
    private readonly locks: DistributedLockService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * 재해 복구 판정 한 번.
   *
   * 조회 하나가 실패해도 나머지는 그대로 담는다 — 저장소가 죽었다고 백업
   * 판정까지 못 보게 되면 장애 대응이 어려워진다.
   */
  async evaluate() {
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

    const now = Date.now();
    const production = process.env.NODE_ENV === "production";

    // 조회는 원격에서 내려받지 않는다 — 기록된 대조 결과를 읽는다 (결정 2001-②)
    const remoteVerifyIntervalMs = this.backups.remoteVerifyIntervalMs;
    const remoteVerifyScheduled =
      resolveSchedules(process.env as Record<string, string | undefined>).find(
        (entry) => entry.job === "remote-verify",
      )?.enabled ?? false;
    const remoteIntegrity = judgeRecordedRemoteIntegrity(health.remoteRecord, {
      now,
      intervalMs: remoteVerifyIntervalMs,
    });

    // 관측 창 상향을 Warning으로 드러낸다 (결정 2101-②)
    const chainWindow = judgeChainWindow(health.chainWindow);

    // 운영 저장소 표준 (결정 1901-③) — S3 전환 여부가 보호 판정의 강도를
    // 좌우한다 (결정 2301-③)
    const storageStandard = judgeStorageStandard(
      process.env.S3_ENDPOINT,
      production,
    );
    const storageProtection = judgeStorageProtection({
      ...protection,
      production,
      label: "이미지 저장소",
    });
    const backupBucketProtection = judgeStorageProtection({
      ...backupProtection,
      production,
      label: "백업 버킷",
    });

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

    const checklist: DrItemDto[] = buildDisasterRecoveryChecklist({
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
        chainWindow,
      },
    });

    return {
      checklist,
      summary: summarizeDisasterRecovery(checklist),
      health,
      backupHistory,
      restoreHistory,
      smtp,
      redis,
      drill,
      drillHistory,
      requirements,
      protection,
      backupProtection,
      storageProtection,
      backupBucketProtection,
      storageStandard,
      restoreTarget,
      restoreTargetVerdict: targetSafety.verdict,
      remoteIntegrity,
      remoteVerifyIntervalMs,
      remoteVerifyScheduled,
      chainWindow,
      production,
    };
  }

  /**
   * 복구 가능 여부만 (CTO 결정 2301-①).
   *
   * 배포 체크리스트가 쓰는 입구다. **판정을 다시 구현하지 않는다** —
   * 같은 조립을 돌려 같은 답을 얻는다. 확인하지 못하면 `null`이다.
   */
  async recoverable(): Promise<boolean | null> {
    try {
      return (await this.evaluate()).summary.recoverable;
    } catch (error) {
      this.logger.warn(
        `복구 판정을 확인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
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
      return { ok: true, detail: await this.storage.check() };
    } catch (error) {
      return {
        ok: false,
        detail: `접근 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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
}
