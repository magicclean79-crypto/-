import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentGovernanceModule } from "../content-governance/content-governance.module";
import { LlmModule } from "../llm/llm.module";
import { PricingModule } from "../pricing/pricing.module";
import { StorageModule } from "../storage/storage.module";
import { AlertService } from "./alert.service";
import { BackupService } from "./backup.service";
import { CostIntelligenceService } from "./cost-intelligence.service";
import { CiStatusService } from "./ci-status.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { MigrationGovernanceService } from "./migration-governance.service";
import { RecoveryDrillService } from "./recovery-drill.service";
import { RecoveryEvaluationService } from "./recovery-evaluation.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationService } from "./notification.service";
import { OpsController } from "./ops.controller";
import { ScheduledChecksService } from "./scheduled-checks.service";

/**
 * 운영 자동화·경보 모듈. (TASK-1302, Sprint 13)
 *
 * 예약 점검(비용 검증·설정 검증·Health Check)이 관측 결과를 경보로 바꾸고,
 * 로그와 (설정 시) 웹훅으로 내보낸다. 판정 로직은 전부 @acos/core에 있다.
 */
@Module({
  // 발행 판정 기록 보관을 예약 정리 작업에 편입한다 (CTO 결정 2501-⑤)
  // 단가 거버넌스는 /ops/pricing이 쓴다 (TASK-3101, CTO 정책 3101-①)
  imports: [
    AuthModule,
    LlmModule,
    StorageModule,
    ContentGovernanceModule,
    PricingModule,
  ],
  controllers: [OpsController],
  providers: [
    AlertService,
    ScheduledChecksService,
    NotificationService,
    NotificationQueueService,
    DistributedLockService,
    BackupService,
    RecoveryDrillService,
    RecoveryEvaluationService,
    MigrationGovernanceService,
    CostIntelligenceService,
    CiStatusService,
    ProductionCutoverService,
  ],
  exports: [
    AlertService,
    ScheduledChecksService,
    NotificationService,
    NotificationQueueService,
    DistributedLockService,
    BackupService,
    RecoveryDrillService,
    RecoveryEvaluationService,
    MigrationGovernanceService,
    CostIntelligenceService,
    CiStatusService,
    ProductionCutoverService,
  ],
})
export class OpsModule {}
