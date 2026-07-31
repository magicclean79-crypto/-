import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentGovernanceModule } from "../content-governance/content-governance.module";
import { LlmModule } from "../llm/llm.module";
import { OcrModule } from "../ocr/ocr.module";
import { PricingModule } from "../pricing/pricing.module";
import { StorageModule } from "../storage/storage.module";
import { AlertService } from "./alert.service";
import { BackupService } from "./backup.service";
import { CostIntelligenceService } from "./cost-intelligence.service";
import { CiStatusService } from "./ci-status.service";
import { EgressService } from "./egress.service";
import { ActivationHistoryService } from "./activation-history.service";
import { IncidentService } from "./incident.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProductionSmokeService } from "./production-smoke.service";
import { AdminSettingsModule } from "../admin/admin-settings.module";
import { IncidentPromotionService } from "./incident-promotion.service";
import { KpiService } from "./kpi.service";
import { OpsSettingsService } from "./ops-settings.service";
import { OpsAuditInterceptor, OpsAuditService } from "./ops-audit.interceptor";
import { OpsEventService } from "./ops-event.service";
import { MigrationGovernanceService } from "./migration-governance.service";
import { RecoveryDrillService } from "./recovery-drill.service";
import { RecoveryEvaluationService } from "./recovery-evaluation.service";
import { DistributedLockService } from "./distributed-lock.service";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationService } from "./notification.service";
import { OpsController } from "./ops.controller";
import { ScheduledChecksService } from "./scheduled-checks.service";
// TASK-4001 (CTO 정책 4001-①②③④⑤⑥)
import { DiagnosticsService } from "./diagnostics.service";
import { DraftLifecycleService } from "./draft-lifecycle.service";
import { KpiTrendService } from "./kpi-trend.service";
import { ValidationPlanService } from "./validation-plan.service";

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
    // 스모크가 **실제로 쓰는 그 어댑터**를 부른다 (TASK-3701, 정책 3701-②) —
    // 따로 만들어 부르면 검증한 것과 운영이 쓰는 것이 달라진다
    OcrModule,
    StorageModule,
    ContentGovernanceModule,
    PricingModule,
    // 운영 설정(임계값·보존·승격)은 관리자 설정 저장소를 쓴다 (TASK-3901)
    AdminSettingsModule,
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
    EgressService,
    ProductionCutoverService,
    ActivationHistoryService,
    ProductionSmokeService,
    IncidentService,
    OpsEventService,
    KpiService,
    OpsAuditService,
    OpsAuditInterceptor,
    OpsSettingsService,
    IncidentPromotionService,
    KpiTrendService,
    DraftLifecycleService,
    DiagnosticsService,
    ValidationPlanService,
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
    EgressService,
    ProductionCutoverService,
    ActivationHistoryService,
    ProductionSmokeService,
    IncidentService,
    OpsEventService,
    KpiService,
    OpsAuditService,
    OpsSettingsService,
    IncidentPromotionService,
    KpiTrendService,
    DraftLifecycleService,
    DiagnosticsService,
    ValidationPlanService,
  ],
})
export class OpsModule {}
