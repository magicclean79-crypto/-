import { Injectable, Logger } from "@nestjs/common";
import { detectDrillAlert, judgeRecoveryDrill } from "@acos/core";
import type { DetectedAlert, DrillHealth } from "@acos/core";
import type { RecoveryDrillDto } from "@acos/shared";
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
export class RecoveryDrillService {
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
    } else {
      this.logger.error(
        `복구 리허설 실패 기록 (${input.performedBy}) — ${input.findings ?? "발견 사항 없음"}`,
      );
    }
    return toDto(row);
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
      const rows = await this.history(20);
      return judgeRecoveryDrill(
        rows.map((entry) => ({
          ok: entry.ok,
          createdAt: new Date(entry.createdAt).getTime(),
        })),
        {
          now: Date.now(),
          intervalMs: this.intervalMs,
          graceMs: this.graceMs,
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
      };
    }
  }

  /** 기한 초과·실패 경보 (CTO 결정 1701-⑤) */
  async detectAlerts(): Promise<DetectedAlert[]> {
    return detectDrillAlert(await this.health());
  }
}
