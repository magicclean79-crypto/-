import { BadRequestException, Injectable } from "@nestjs/common";
import { buildExecutionStats, buildExecutionTotals } from "@acos/core";
import type { ExecutionStatGroupRow } from "@acos/core";
import type { ExecutionDashboardDto, ExecutionDto } from "@acos/shared";
import type { Execution, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function toDto(record: Execution): ExecutionDto {
  return {
    id: record.id,
    feature: record.feature,
    provider: record.provider,
    model: record.model,
    status: record.status,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cost: record.cost === null ? null : Number(record.cost),
    latencyMs: record.latencyMs,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Execution 조회 서비스 — 기록은 LlmService(ExecutionTracker)가 담당한다 */
@Injectable()
export class ExecutionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(options: {
    feature?: string;
    limit?: number;
  }): Promise<ExecutionDto[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(
        `limit은 1~${MAX_LIMIT} 사이의 정수여야 합니다.`,
      );
    }

    const records = await this.prisma.execution.findMany({
      where: options.feature ? { feature: options.feature } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return records.map(toDto);
  }

  /**
   * Execution Dashboard (TASK-0602) — 호출 수·성공/실패율·토큰·비용·지연을
   * 전체 + feature/provider/model별로 집계한다.
   * DB에서 (차원, status) 단위 groupBy 후 @acos/core의 순수 로직으로 병합.
   */
  async dashboard(options: {
    from?: Date;
    to?: Date;
  }): Promise<ExecutionDashboardDto> {
    if (options.from && options.to && options.from > options.to) {
      throw new BadRequestException("from은 to보다 이후일 수 없습니다.");
    }
    const where: Prisma.ExecutionWhereInput | undefined =
      options.from || options.to
        ? {
            createdAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
        : undefined;

    const [statusRows, featureRows, providerRows, modelRows] =
      await Promise.all([
        this.groupBy("status", where),
        this.groupBy("feature", where),
        this.groupBy("provider", where),
        this.groupBy("model", where),
      ]);

    return {
      range: {
        from: options.from?.toISOString() ?? null,
        to: options.to?.toISOString() ?? null,
      },
      totals: buildExecutionTotals(statusRows),
      byFeature: buildExecutionStats(featureRows),
      byProvider: buildExecutionStats(providerRows),
      byModel: buildExecutionStats(modelRows),
    };
  }

  /** (차원, status) 단위 DB 집계 → core 병합 입력 행으로 변환 */
  private async groupBy(
    dimension: "status" | "feature" | "provider" | "model",
    where: Prisma.ExecutionWhereInput | undefined,
  ): Promise<ExecutionStatGroupRow[]> {
    const by =
      dimension === "status"
        ? (["status"] as const)
        : ([dimension, "status"] as const);
    const rows = await this.prisma.execution.groupBy({
      by: [...by],
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cost: true },
      _avg: { latencyMs: true },
      _max: { latencyMs: true },
    });
    return rows.map((row) => ({
      key:
        dimension === "status"
          ? ""
          : String((row as Record<string, unknown>)[dimension]),
      status: row.status,
      count: row._count._all,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
      cost: row._sum.cost === null ? null : Number(row._sum.cost),
      avgLatencyMs: row._avg.latencyMs,
      maxLatencyMs: row._max.latencyMs,
    }));
  }
}
