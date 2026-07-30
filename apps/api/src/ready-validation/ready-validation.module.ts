import { Module } from "@nestjs/common";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { ContentGovernanceModule } from "../content-governance/content-governance.module";
import { ReadyValidationController } from "./ready-validation.controller";
import { ReadyValidationService } from "./ready-validation.service";

/**
 * READY Validation Engine 모듈 (TASK-0404) — Company Brain 기반 검수 판정.
 * 거버넌스 규칙은 발행 게이트와 같은 곳에서 읽는다 (TASK-2501).
 */
@Module({
  imports: [CompanyBrainModule, ContentGovernanceModule],
  controllers: [ReadyValidationController],
  providers: [ReadyValidationService],
})
export class ReadyValidationModule {}
