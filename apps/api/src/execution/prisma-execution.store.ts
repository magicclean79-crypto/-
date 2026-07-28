import { Injectable } from "@nestjs/common";
import type { ExecutionRecord, ExecutionStore, NewExecution } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/** ExecutionStore Port의 Prisma 어댑터 — executions 테이블 (TASK-0601) */
@Injectable()
export class PrismaExecutionStore implements ExecutionStore {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: NewExecution): Promise<ExecutionRecord> {
    const record = await this.prisma.execution.create({ data: entry });
    return {
      ...entry,
      id: record.id,
      createdAt: record.createdAt,
    };
  }
}
