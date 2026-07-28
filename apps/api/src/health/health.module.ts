import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { StorageModule } from "../storage/storage.module";
import { HealthController } from "./health.controller";
import { ReadinessService } from "./readiness.service";

/**
 * Production Readiness 모듈. (TASK-1202, Sprint 12)
 * 환경 검증·구성 요소 점검·배포 체크리스트를 제공한다.
 */
@Module({
  imports: [AuthModule, LlmModule, StorageModule],
  controllers: [HealthController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class HealthModule {}
