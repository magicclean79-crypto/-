import { Module } from "@nestjs/common";
import { CompanyBrainController } from "./company-brain.controller";
import { CompanyBrainService } from "./company-brain.service";

/** Company Brain Query 모듈 (TASK-0403) — 4개 저장소의 읽기 전용 통합 조회 */
@Module({
  controllers: [CompanyBrainController],
  providers: [CompanyBrainService],
  exports: [CompanyBrainService],
})
export class CompanyBrainModule {}
