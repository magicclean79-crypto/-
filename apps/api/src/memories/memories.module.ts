import { Module } from "@nestjs/common";
import { MemoriesController } from "./memories.controller";
import { MemoriesService } from "./memories.service";
import { PrismaMemoryStore } from "./prisma-memory.store";

/** Memory 모듈 (TASK-0307) — Company Brain의 기억 저장소 */
@Module({
  controllers: [MemoriesController],
  providers: [MemoriesService, PrismaMemoryStore],
})
export class MemoriesModule {}
