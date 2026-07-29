import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { AlertService } from "./alert.service";
import { DistributedLockService } from "./distributed-lock.service";
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
  imports: [AuthModule, LlmModule],
  controllers: [OpsController],
  providers: [
    AlertService,
    ScheduledChecksService,
    NotificationService,
    DistributedLockService,
  ],
  exports: [
    AlertService,
    ScheduledChecksService,
    NotificationService,
    DistributedLockService,
  ],
})
export class OpsModule {}
