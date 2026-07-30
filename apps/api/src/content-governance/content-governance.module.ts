import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { ContentGovernanceService } from "./content-governance.service";
import { GovernancePreflightService } from "./governance-preflight.service";
import { GovernanceRulesService } from "./governance-rules.service";
import { GovernanceController } from "./governance.controller";

/**
 * Content Governance 모듈. (TASK-2501, Sprint 25)
 *
 * 거버넌스 규칙을 읽는 곳과 판정하는 곳을 **각각 하나로** 모은다.
 * READY 판정(`ReadyValidationModule`)과 발행 게이트(`ContentsModule`)가
 * 둘 다 이 모듈을 가져다 쓴다 — 규칙이 두 곳에 있으면 두 곳이 갈라진다.
 */
@Module({
  imports: [AuthModule, CompanyBrainModule],
  controllers: [GovernanceController],
  providers: [
    GovernanceRulesService,
    ContentGovernanceService,
    GovernancePreflightService,
  ],
  exports: [
    GovernanceRulesService,
    ContentGovernanceService,
    GovernancePreflightService,
  ],
})
export class ContentGovernanceModule {}
