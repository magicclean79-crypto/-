import { Injectable } from "@nestjs/common";
import type { ExecutionRecord, ExecutionStore, NewExecution } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/** ExecutionStore Port의 Prisma 어댑터 — executions 테이블 (TASK-0601) */
@Injectable()
export class PrismaExecutionStore implements ExecutionStore {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: NewExecution): Promise<ExecutionRecord> {
    // 토큰 상세는 도메인에서 **한 덩어리**(TASK-4701)이고 테이블에서는 세
    // 칸입니다. 여기서 펼칩니다 — 도메인이 컬럼 모양을 알 필요는 없고,
    // 테이블이 중첩 객체를 받을 수도 없습니다.
    const { usageDetail, ...columns } = entry;

    const record = await this.prisma.execution.create({
      data: {
        ...columns,
        cachedInputTokens: usageDetail?.cachedInputTokens ?? null,
        cacheWriteTokens: usageDetail?.cacheWriteTokens ?? null,
        reasoningTokens: usageDetail?.reasoningTokens ?? null,
      },
    });
    return {
      ...entry,
      id: record.id,
      createdAt: record.createdAt,
    };
  }
}
