import { Module } from "@nestjs/common";
import { DecisionsController } from "./decisions.controller";
import { DecisionsService } from "./decisions.service";
import { PrismaDecisionRepository } from "./prisma-decision.repository";

/** Decision Log 모듈 (TASK-0306) — Company Brain의 의사결정 기록 */
@Module({
  controllers: [DecisionsController],
  providers: [DecisionsService, PrismaDecisionRepository],
})
export class DecisionsModule {}
