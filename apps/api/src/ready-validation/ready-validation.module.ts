import { Module } from "@nestjs/common";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { ReadyValidationController } from "./ready-validation.controller";
import { ReadyValidationService } from "./ready-validation.service";

/** READY Validation Engine 모듈 (TASK-0404) — Company Brain 기반 검수 판정 */
@Module({
  imports: [CompanyBrainModule],
  controllers: [ReadyValidationController],
  providers: [ReadyValidationService],
})
export class ReadyValidationModule {}
