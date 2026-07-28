import { Injectable, Logger } from "@nestjs/common";
import {
  buildDeploymentChecklist,
  describeEnvironment,
  summarizeChecklist,
  validateEnvironment,
} from "@acos/core";
import type { EnvValidationResult } from "@acos/core";
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
   * 미적용 마이그레이션 수. Prisma의 `_prisma_migrations`를 직접 본다 —
   * 확인할 수 없으면 `null`을 돌려 체크리스트가 "직접 확인"으로 남긴다
   * (모르는 것을 통과로 처리하지 않는다).
   */
  private async pendingMigrations(): Promise<number | null> {
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
   * 배포 준비 보고 (Configuration Verification + Deployment Checklist).
   * 점검은 병렬로 돌리되, 하나가 실패해도 나머지 결과는 그대로 담는다.
   */
  async report(): Promise<ReadinessReportDto> {
    const environment = this.validateEnv();
    const [database, storage, pending, adminUser, budgetStatus] =
      await Promise.all([
        this.checkDatabase(),
        this.checkStorage(),
        this.pendingMigrations(),
        this.adminUserExists(),
        this.budget.status().catch(() => null),
      ]);

    const routing = this.llm.routing();
    const budgetConfigured = Boolean(
      budgetStatus?.daily.budget || budgetStatus?.monthly.budget,
    );

    const checklist = buildDeploymentChecklist({
      environment,
      database: { ok: database.ok, detail: database.detail },
      pendingMigrations: pending,
      storage: { ok: storage.ok, detail: storage.detail },
      availableProviders: routing.availableProviders,
      defaultProvider: routing.defaultProvider,
      budgetConfigured,
      failoverConfigured: failoverPriority().length > 0,
      adminUserExists: adminUser,
      production: environment.production,
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
      pendingMigrations: pending,
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
