import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { PrismaKnowledgeRepository } from "./prisma-knowledge.repository";

/** Knowledge 모듈 (TASK-0401) — Company Brain의 회사 전역 지식 */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, PrismaKnowledgeRepository],
})
export class KnowledgeModule {}
