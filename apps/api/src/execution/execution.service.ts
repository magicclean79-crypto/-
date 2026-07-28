import { BadRequestException, Injectable } from "@nestjs/common";
import type { ExecutionDto } from "@acos/shared";
import type { Execution } from "@prisma/client";
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
}
