import { Module } from "@nestjs/common";
import { MemoryController } from "./memory.controller";
import { MemoryService } from "./memory.service";
import { PrismaMemoryStore } from "./prisma-memory.store";

/** 표준 Structured Memory 모듈 (TASK-0402) — Company Brain의 구조화 저장소 */
@Module({
  controllers: [MemoryController],
  providers: [MemoryService, PrismaMemoryStore],
})
export class MemoryModule {}
