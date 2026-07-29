import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DRILL_TRIGGERS,
  detectDrillAlert,
  hasPendingTrigger,
  judgeRecoveryDrill,
} from "@acos/core";
import type {
  DetectedAlert,
  DrillHealth,
  DrillRequirementInput,
  DrillTrigger,
} from "@acos/core";
import type { DrillRequirementDto, RecoveryDrillDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DrillRow {
  id: string;
  ok: boolean;
  performedBy: string;
  durationMs: number | null;
  findings: string | null;
  notes: string | null;
  createdAt: Date;
}

interface RequirementRow {
  id: string;
  trigger: string;
  description: string;
  registeredBy: string;
  satisfiedAt: Date | null;
  satisfiedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: Date;
}

function toRequirementDto(row: RequirementRow): DrillRequirementDto {
  return {
    id: row.id,
    trigger: row.trigger,
    description: row.description,
    registeredBy: row.registeredBy,
    satisfiedAt: row.satisfiedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledBy: row.cancelledBy ?? null,
    cancelReason: row.cancelReason ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDto(row: DrillRow): RecoveryDrillDto {
  return {
    id: row.id,
    ok: row.ok,
    performedBy: row.performedBy,
    durationMs: row.durationMs,
    findings: row.findings,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Recovery Drill Registry. (TASK-1801, Sprint 18 — CTO 결정 1701-⑤)
 *
 * **분기 1회 복구 리허설이 운영 표준이 됐다.**
 *
 * 자동화할 수 없는 일을 자동화하려는 것이 아니다 — 리허설 자체는 사람이
 * 한다. 이 서비스가 하는 일은 **한 사실을 기록하고, 안 하면 드러나게** 하는
 * 것이다. 기록되지 않는 규칙은 지켜지지 않는다.
 *
 * 기록은 **지우지 않는다** — 언제 무엇이 어긋났는지가 다음 리허설의 입력이다.
 */
@Injectable()
export class RecoveryDrillService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryDrillService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 리허설 주기 (CTO 결정 1701-⑤ — 기본 분기 1회) */
  get intervalMs(): number {
    const raw = Number(process.env.OPS_DRILL_INTERVAL_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw * DAY_MS : 90 * DAY_MS;
  }

  /** 기한 초과 후 경보까지의 유예 */
  get graceMs(): number {
    const raw = Number(process.env.OPS_DRILL_GRACE_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw * DAY_MS : 14 * DAY_MS;
  }

  /**
   * 리허설 결과 기록.
   *
   * **실패한 리허설도 기록한다** — 오히려 그쪽이 값지다. 절차가 깨졌다는
   * 사실을 사고 전에 알아낸 것이기 때문이다. 성공만 남기면 기록은 장식이 된다.
   */
  async record(input: {
    ok: boolean;
    performedBy: string;
    durationMs?: number | null;
    findings?: string | null;
    notes?: string | null;
  }): Promise<RecoveryDrillDto> {
    const row = (await this.prisma.recoveryDrill.create({
      data: {
        ok: input.ok,
        performedBy: input.performedBy,
        durationMs: input.durationMs ?? null,
        findings: input.findings ?? null,
        notes: input.notes ?? null,
      },
    })) as DrillRow;

    if (input.ok) {
      this.logger.log(`복구 리허설 기록 (${input.performedBy}) — 성공`);
      // 성공한 리허설만 변경 사건을 해소한다 (CTO 결정 1801-⑤) —
      // 실패한 리허설은 "확인했다"가 아니라 "안 되더라"는 뜻이다
      await this.satisfyRequirements(row.id, row.createdAt);
    } else {
      this.logger.error(
        `복구 리허설 실패 기록 (${input.performedBy}) — ${input.findings ?? "발견 사항 없음"}`,
      );
    }
    return toDto(row);
  }

  /**
   * 변경 사건 등록 (CTO 결정 1801-⑤).
   *
   * DR 절차·DB·백업 방식이 크게 바뀌면 **주기와 무관하게** 리허설을 다시
   * 해야 한다 — 마지막 리허설이 검증한 것은 지금의 시스템이 아니기 때문이다.
   */
  async requireDrill(input: {
    trigger: DrillTrigger;
    description: string;
    registeredBy: string;
  }): Promise<DrillRequirementDto> {
    // 같은 종류가 미해소면 중복 등록을 막는다 (CTO 결정 1901-⑤) —
    // 같은 사건이 여러 건 쌓이면 리허설 한 번으로 몇 건이 해소됐는지 흐려진다
    if (hasPendingTrigger(await this.requirementInputs(), input.trigger)) {
      throw new ConflictException(
        `${input.trigger} 요구가 이미 미해소 상태입니다 — 리허설을 수행하거나 기존 요구를 취소하세요.`,
      );
    }
    const row = (await this.prisma.drillRequirement.create({
      data: {
        trigger: input.trigger,
        description: input.description,
        registeredBy: input.registeredBy,
      },
    })) as RequirementRow;
    this.logger.warn(
      `변경 후 리허설 요구 등록 (${input.trigger}) — ${input.description}`,
    );
    return toRequirementDto(row);
  }

  /**
   * 요구 취소 (CTO 결정 1901-②).
   *
   * **삭제하지 않는다** — 잘못 등록한 것도 기록으로 남아야 하고, 왜 취소했는지가
   * 다음 판단의 근거가 된다. 이미 해소된 요구는 취소할 것이 없다.
   */
  async cancelRequirement(
    id: string,
    input: { cancelledBy: string; reason: string },
  ): Promise<DrillRequirementDto> {
    const existing = (await this.prisma.drillRequirement.findUnique({
      where: { id },
    })) as RequirementRow | null;
    if (!existing) {
      throw new NotFoundException("요구를 찾을 수 없습니다.");
    }
    if (existing.satisfiedAt !== null) {
      throw new ConflictException(
        "이미 리허설로 해소된 요구입니다 — 취소할 것이 없습니다.",
      );
    }
    if (existing.cancelledAt !== null) {
      throw new ConflictException("이미 취소된 요구입니다.");
    }

    const row = (await this.prisma.drillRequirement.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        cancelledBy: input.cancelledBy,
        cancelReason: input.reason,
      },
    })) as RequirementRow;
    this.logger.warn(
      `리허설 요구 취소 (${existing.trigger}, ${input.cancelledBy}) — ${input.reason}`,
    );
    return toRequirementDto(row);
  }

  /**
   * Major Migration 자동 등록 (CTO 결정 1901-①).
   *
   * **지정된 마이그레이션만** 리허설을 부른다 — 사소한 컬럼 추가까지 리허설을
   * 부르면 규칙이 소음이 되고, 소음이 된 규칙은 지켜지지 않는다. 무엇이
   * major인지는 `prisma/major-migrations.json`에 사람이 적는다.
   *
   * `dr-change`·`pitr-adoption`은 자동 등록하지 않는다 — 코드로는 알 수 없는
   * 사건이라 운영자가 직접 등록한다.
   */
  async onModuleInit(): Promise<void> {
    try {
      const applied = await this.appliedMajorMigrations();
      if (applied.length === 0) {
        return;
      }
      if (hasPendingTrigger(await this.requirementInputs(), "db-major-change")) {
        return;
      }
      const known = await this.requirements(100);
      // 이미 이 마이그레이션으로 등록한 적이 있으면 다시 만들지 않는다
      const marker = `major-migration:${applied[applied.length - 1]}`;
      if (known.some((entry) => entry.description.includes(marker))) {
        return;
      }
      await this.prisma.drillRequirement.create({
        data: {
          trigger: "db-major-change",
          description: `Major Migration 적용 — ${marker}`,
          registeredBy: "system",
        },
      });
      this.logger.warn(
        `Major Migration(${applied[applied.length - 1]}) 적용으로 복구 리허설 요구를 자동 등록했습니다 (CTO 결정 1901-①).`,
      );
    } catch (error) {
      // 자동 등록 실패가 기동을 막지는 않는다 — 다만 조용히 넘기지도 않는다
      this.logger.warn(
        `Major Migration 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 선언된 major 목록 중 실제로 적용된 것 */
  private async appliedMajorMigrations(): Promise<string[]> {
    const declared = await this.majorMigrationManifest();
    if (declared.length === 0) {
      return [];
    }
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at ASC`,
    )) as { migration_name: string }[];
    const appliedNames = new Set(rows.map((row) => row.migration_name));
    return declared.filter((name) => appliedNames.has(name));
  }

  private async majorMigrationManifest(): Promise<string[]> {
    try {
      const path = join(process.cwd(), "prisma", "major-migrations.json");
      const parsed = JSON.parse(await readFile(path, "utf8")) as {
        majorMigrations?: string[];
      };
      return Array.isArray(parsed.majorMigrations) ? parsed.majorMigrations : [];
    } catch {
      // 목록이 없으면 자동 등록할 것도 없다 — 오류가 아니다
      return [];
    }
  }

  /** 성공한 리허설로 미해소 요구를 닫는다 */
  private async satisfyRequirements(
    drillId: string,
    at: Date,
  ): Promise<number> {
    try {
      const result = await this.prisma.drillRequirement.updateMany({
        // 취소된 요구는 해소 대상이 아니다
        where: { satisfiedAt: null, cancelledAt: null },
        data: { satisfiedAt: at, satisfiedBy: drillId },
      });
      if (result.count > 0) {
        this.logger.log(
          `변경 후 리허설 요구 ${result.count}건이 해소됐습니다.`,
        );
      }
      return result.count;
    } catch (error) {
      this.logger.warn(
        `리허설 요구 해소 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  async requirements(limit = 20): Promise<DrillRequirementDto[]> {
    const rows = (await this.prisma.drillRequirement.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as RequirementRow[];
    return rows.map(toRequirementDto);
  }

  private async requirementInputs(): Promise<DrillRequirementInput[]> {
    try {
      const rows = (await this.prisma.drillRequirement.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      })) as RequirementRow[];
      return rows
        // 알 수 없는 종류는 버린다 — 판정에 넣으면 이름을 못 붙인다
        .filter((row) =>
          (DRILL_TRIGGERS as readonly string[]).includes(row.trigger),
        )
        .map((row) => ({
          trigger: row.trigger as DrillTrigger,
          createdAt: row.createdAt.getTime(),
          satisfiedAt: row.satisfiedAt?.getTime() ?? null,
          cancelledAt: row.cancelledAt?.getTime() ?? null,
        }));
    } catch {
      return [];
    }
  }

  async history(limit = 10): Promise<RecoveryDrillDto[]> {
    const rows = (await this.prisma.recoveryDrill.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as DrillRow[];
    return rows.map(toDto);
  }

  /** 리허설 상태 판정 (core 순수 로직) */
  async health(): Promise<DrillHealth> {
    try {
      const [rows, requirements] = await Promise.all([
        this.history(20),
        this.requirementInputs(),
      ]);
      return judgeRecoveryDrill(
        rows.map((entry) => ({
          ok: entry.ok,
          createdAt: new Date(entry.createdAt).getTime(),
        })),
        {
          now: Date.now(),
          intervalMs: this.intervalMs,
          graceMs: this.graceMs,
          requirements,
        },
      );
    } catch (error) {
      // 이력을 읽지 못한 것을 "리허설을 안 했다"로 바꾸면 거짓 경보가 된다
      this.logger.warn(
        `리허설 이력 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        status: "manual",
        detail: "리허설 이력을 읽지 못했습니다 — 직접 확인하세요.",
        ageMs: null,
        dueAt: null,
        overdueDays: 0,
        intervalMs: this.intervalMs,
        pendingTriggers: [],
        lastFailed: false,
      };
    }
  }

  /** 기한 초과·실패 경보 (CTO 결정 1701-⑤) */
  async detectAlerts(): Promise<DetectedAlert[]> {
    return detectDrillAlert(await this.health());
  }
}
