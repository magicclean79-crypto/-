import { Injectable, Logger } from "@nestjs/common";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildDeploymentChecklist,
  describeEnvironment,
  judgeMigrations,
  summarizeChecklist,
  validateEnvironment,
} from "@acos/core";
import type { EnvValidationResult, MigrationState } from "@acos/core";
import type {
  ComponentHealthDto,
  ReadinessReportDto,
} from "@acos/shared";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { failoverPriority } from "../llm/failover-config";
import { LlmBudgetService } from "../llm/llm-budget.service";

/**
 * Production Readiness. (TASK-1202, Sprint 12)
 *
 * "배포해도 되는가"를 **실제 상태로 판정**한다. 환경변수 선언(core)을 단일
 * 원천으로 삼아 검증하고, DB·저장소·Provider·관리자 계정을 직접 확인해
 * 배포 체크리스트를 채운다.
 *
 * 각 점검은 **독립적으로 실패**한다 — 저장소가 죽었다고 DB 상태까지
 * 못 보게 되면 장애 대응이 어려워지기 때문이다.
 */
@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly budget: LlmBudgetService,
    private readonly storage: StorageService,
  ) {}

  /** 환경 검증 (Environment Validation) */
  validateEnv(): EnvValidationResult {
    return validateEnvironment(process.env);
  }

  private async checkDatabase(): Promise<ComponentHealthDto> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        name: "database",
        ok: true,
        detail: "연결 정상",
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        name: "database",
        ok: false,
        detail: `연결 실패: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * 스키마 적용 상태 (TASK-2301, CTO 결정 2201-①).
   *
   * **실패 행만 세면 미적용을 알 수 없다** — 적용하지 않은 마이그레이션은
   * 실패 행조차 남기지 않으므로, 그것만 보면 "미적용 없음"이라는 거짓 통과가
   * 나온다. 그래서 마이그레이션 디렉터리와 적용 기록을 **대조한다.**
   *
   * 애플리케이션은 적용하지 않는다 — 검증만 한다.
   */
  private async migrationState(): Promise<MigrationState> {
    const [directories, applied, failed] = await Promise.all([
      this.migrationDirectories(),
      this.appliedMigrations(),
      this.failedMigrations(),
    ]);
    return { directories, applied, failed };
  }

  private async migrationDirectories(): Promise<string[] | null> {
    try {
      const entries = await readdir(
        join(process.cwd(), "prisma", "migrations"),
        { withFileTypes: true },
      );
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      // 읽지 못한 것을 "없음"으로 세지 않는다
      return null;
    }
  }

  private async appliedMigrations(): Promise<string[] | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at ASC
      `;
      return rows.map((row) => row.migration_name);
    } catch {
      return null;
    }
  }

  private async failedMigrations(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM _prisma_migrations
        WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
      `;
      return Number(rows[0]?.count ?? 0);
    } catch {
      return null;
    }
  }

  private async checkStorage(): Promise<ComponentHealthDto> {
    const startedAt = Date.now();
    try {
      const detail = await this.storage.check();
      return {
        name: "storage",
        ok: true,
        detail,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        name: "storage",
        ok: false,
        detail: `접근 실패: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private async adminUserExists(): Promise<boolean> {
    try {
      const count = await this.prisma.user.count({
        where: { role: "ADMIN", disabled: false },
      });
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * 운영 표준 배포 체크리스트 입력 (TASK-2301, CTO 결정 2201-④).
   *
   * 운영에서 애플리케이션은 버킷·IAM·스키마를 만들지 않고 **검증만** 하므로,
   * 배포 전에 사람이 준비했는지 확인하는 것이 절차의 일부가 된다.
   *
   * 각 조회는 **따로 실패한다** — 버킷을 못 읽었다고 복구 판정까지 못 보면
   * 배포 판단이 어려워진다. 읽지 못한 값은 `null`로 남겨 `직접 확인`이 된다.
   */
  private async operationsState() {
    const [bucketExists, backupBucketExists, protection, backupProtection, recoverable] =
      await Promise.all([
        this.storage.bucketExists().catch(() => null),
        this.storage.bucketExists(this.storage.backupBucket).catch(() => null),
        this.storage
          .describeProtection()
          .catch(() => ({ versioning: "unknown" as const, replication: "unknown" as const })),
        this.storage
          .describeBackupProtection()
          .catch(() => ({ versioning: "unknown" as const, replication: "unknown" as const })),
        this.recoverable(),
      ]);

    return {
      provisioningMode: this.storage.provisioning.mode,
      bucket: { name: this.storage.bucket, exists: bucketExists },
      backupBucket: {
        name: this.storage.backupBucket,
        exists: backupBucketExists,
        separated: this.storage.backupBucket !== this.storage.bucket,
      },
      versioning: protection.versioning,
      backupVersioning: backupProtection.versioning,
      recoverable,
    };
  }

  /**
   * 재해 복구 판정 (`/ops/readiness`의 `recoverable`).
   *
   * 배포 체크리스트가 운영 대시보드를 **직접 부르지 않는다** — 순환 의존이
   * 되고, 한쪽이 느려지면 다른 쪽이 함께 멈춘다. 대신 복구 필수 항목의
   * 근거인 **백업·복원 이력만** 확인한다. 확인하지 못하면 null이다.
   */
  private async recoverable(): Promise<boolean | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        { backups: bigint; restores: bigint }[]
      >`
        SELECT
          (SELECT COUNT(*)::bigint FROM backup_runs WHERE ok = true) AS backups,
          (SELECT COUNT(*)::bigint FROM restore_runs WHERE ok = true) AS restores
      `;
      const row = rows[0];
      if (!row) {
        return null;
      }
      // 백업이 있고 복원해 본 적이 있어야 "복구 가능"의 최소 조건이다
      return Number(row.backups) > 0 && Number(row.restores) > 0;
    } catch {
      return null;
    }
  }

  /**
   * 배포 준비 보고 (Configuration Verification + Deployment Checklist).
   * 점검은 병렬로 돌리되, 하나가 실패해도 나머지 결과는 그대로 담는다.
   */
  async report(): Promise<ReadinessReportDto> {
    const environment = this.validateEnv();
    const [database, storage, migrationState, adminUser, budgetStatus, ops] =
      await Promise.all([
        this.checkDatabase(),
        this.checkStorage(),
        this.migrationState(),
        this.adminUserExists(),
        this.budget.status().catch(() => null),
        this.operationsState(),
      ]);
    const migrations = judgeMigrations(migrationState, {
      production: environment.production,
    });

    const routing = this.llm.routing();
    const budgetConfigured = Boolean(
      budgetStatus?.daily.budget || budgetStatus?.monthly.budget,
    );

    const checklist = buildDeploymentChecklist({
      environment,
      database: { ok: database.ok, detail: database.detail },
      migrations,
      storage: { ok: storage.ok, detail: storage.detail },
      availableProviders: routing.availableProviders,
      defaultProvider: routing.defaultProvider,
      budgetConfigured,
      failoverConfigured: failoverPriority().length > 0,
      adminUserExists: adminUser,
      production: environment.production,
      operations: ops,
    });

    return {
      ready: summarizeChecklist(checklist).ready,
      production: environment.production,
      nodeEnv: process.env.NODE_ENV ?? "development",
      environment: {
        ok: environment.ok,
        errors: environment.errors,
        warnings: environment.warnings,
        checked: environment.checked,
      },
      components: [database, storage],
      // 미적용 목록의 길이 — 실패 행 수가 아니라 **실제 미적용 건수**다
      pendingMigrations:
        migrationState.directories === null || migrationState.applied === null
          ? null
          : migrations.pending.length,
      migrations,
      providers: {
        available: routing.availableProviders,
        default: routing.defaultProvider,
      },
      checklist,
      summary: summarizeChecklist(checklist),
      configuration: describeEnvironment(process.env),
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 기동 검증 (Startup Validation).
   *
   * **운영에서 환경 오류가 있으면 기동을 막는다** — 잘못된 설정으로 뜬
   * 서버는 조용히 오작동하다가 더 큰 사고를 만든다. 개발에서는 같은 문제를
   * 경고로만 알린다(mock 구성이 정상이므로).
   */
  validateOnStartup(): { ok: boolean; fatal: boolean } {
    const result = this.validateEnv();

    for (const issue of result.warnings) {
      this.logger.warn(`환경 권고 [${issue.name}] ${issue.message}`);
    }
    for (const issue of result.errors) {
      this.logger.error(`환경 오류 [${issue.name}] ${issue.message}`);
    }

    if (result.ok) {
      this.logger.log(
        `환경 검증 통과 (${result.checked}개 항목, ${result.production ? "production" : "development"}` +
          `${result.warnings.length > 0 ? `, 권고 ${result.warnings.length}건` : ""})`,
      );
      return { ok: true, fatal: false };
    }

    // 운영에서만 치명적으로 본다
    return { ok: false, fatal: result.production };
  }
}
