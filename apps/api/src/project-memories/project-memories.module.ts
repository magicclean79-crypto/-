import { Module } from "@nestjs/common";
import { ProjectMemoriesController } from "./project-memories.controller";
import { ProjectMemoriesService } from "./project-memories.service";
import { PrismaProjectMemoryStore } from "./prisma-project-memory.store";

/** ProjectMemory 모듈 (TASK-0307) — Company Brain의 기억 저장소 */
@Module({
  controllers: [ProjectMemoriesController],
  providers: [ProjectMemoriesService, PrismaProjectMemoryStore],
})
export class ProjectMemoriesModule {}
