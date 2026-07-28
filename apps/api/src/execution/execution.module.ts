import { Module } from "@nestjs/common";
import { EXECUTION_STORE } from "./execution.constants";
import { ExecutionController } from "./execution.controller";
import { ExecutionService } from "./execution.service";
import { PrismaExecutionStore } from "./prisma-execution.store";

/**
 * Execution Domain 모듈. (TASK-0601, Sprint 6)
 *
 * 모든 LLM 호출은 LlmService가 ExecutionTracker(@acos/core)로 감싸
 * EXECUTION_STORE에 1건씩 기록한다 — 이 모듈은 저장소(Prisma 어댑터)와
 * 조회 API(GET /executions)를 제공한다.
 */
@Module({
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    PrismaExecutionStore,
    { provide: EXECUTION_STORE, useExisting: PrismaExecutionStore },
  ],
  exports: [EXECUTION_STORE],
})
export class ExecutionModule {}
