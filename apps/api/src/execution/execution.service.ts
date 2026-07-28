import { BadRequestException, Injectable } from "@nestjs/common";
import {
  buildExecutionStats,
  buildExecutionTimeline,
  buildExecutionTotals,
} from "@acos/core";
import type { ExecutionStatGroupRow } from "@acos/core";
import { EXECUTION_TIMELINE_INTERVALS } from "@acos/shared";
import type {
  ExecutionDashboardDto,
  ExecutionDto,
  ExecutionTimelineDto,
  ExecutionTimelineInterval,
} from "@acos/shared";
import { Prisma } from "@prisma/client";
import type { Execution } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** date_trunc 집계 결과 행 — $queryRaw 반환 형태 */
interface TimelineRow {
  bucketStart: Date;
  status: "SUCCESS" | "FAILED";
  count: number;
  inputTokens: number;
  outputTokens: number;
  cost: unknown | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
}

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

  /**
   * Execution Timeline (TASK-0605) — hour/day/week 단위(UTC date_trunc)
   * 시간 축 집계. feature/provider/model 필터 지원.
   * DB에서 (버킷, status) 단위 집계 후 @acos/core 병합 로직으로 통계화한다.
   */
  async timeline(options: {
    interval: string;
    from?: Date;
    to?: Date;
    feature?: string;
    provider?: string;
    model?: string;
  }): Promise<ExecutionTimelineDto> {
    const interval = options.interval as ExecutionTimelineInterval;
    if (!EXECUTION_TIMELINE_INTERVALS.includes(interval)) {
      throw new BadRequestException(
        `interval은 다음 중 하나여야 합니다: ${EXECUTION_TIMELINE_INTERVALS.join(", ")}`,
      );
    }
    if (options.from && options.to && options.from > options.to) {
      throw new BadRequestException("from은 to보다 이후일 수 없습니다.");
    }

    const conditions: Prisma.Sql[] = [];
    if (options.from) {
      conditions.push(Prisma.sql`"createdAt" >= ${options.from}`);
    }
    if (options.to) {
      conditions.push(Prisma.sql`"createdAt" <= ${options.to}`);
    }
    if (options.feature) {
      conditions.push(Prisma.sql`"feature" = ${options.feature}`);
    }
    if (options.provider) {
      conditions.push(Prisma.sql`"provider" = ${options.provider}`);
    }
    if (options.model) {
      conditions.push(Prisma.sql`"model" = ${options.model}`);
    }
    const where =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    // interval은 화이트리스트 검증을 통과한 값만 바인딩된다
    const rows = await this.prisma.$queryRaw<TimelineRow[]>(Prisma.sql`
      SELECT
        date_trunc(${interval}, "createdAt") AS "bucketStart",
        "status",
        COUNT(*)::int            AS "count",
        COALESCE(SUM("inputTokens"), 0)::int  AS "inputTokens",
        COALESCE(SUM("outputTokens"), 0)::int AS "outputTokens",
        SUM("cost")              AS "cost",
        AVG("latencyMs")::float8 AS "avgLatencyMs",
        MAX("latencyMs")::int    AS "maxLatencyMs"
      FROM "executions"
      ${where}
      GROUP BY "bucketStart", "status"
    `);

    // createdAt은 UTC 기준 저장 — date_trunc 결과도 UTC 버킷 시작 시각이다
    const statRows: ExecutionStatGroupRow[] = rows.map((row) => ({
      key: row.bucketStart.toISOString(),
      status: row.status,
      count: row.count,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cost: row.cost === null ? null : Number(row.cost),
      avgLatencyMs: row.avgLatencyMs,
      maxLatencyMs: row.maxLatencyMs,
    }));

    return {
      interval,
      range: {
        from: options.from?.toISOString() ?? null,
        to: options.to?.toISOString() ?? null,
      },
      filter: {
        feature: options.feature ?? null,
        provider: options.provider ?? null,
        model: options.model ?? null,
      },
      buckets: buildExecutionTimeline(statRows),
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
