import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { OpsModule } from "../ops/ops.module";
import { StorageModule } from "../storage/storage.module";
import { HealthController } from "./health.controller";
import { ReadinessService } from "./readiness.service";

/**
 * Production Readiness 모듈. (TASK-1202, Sprint 12)
 * 환경 검증·구성 요소 점검·배포 체크리스트를 제공한다.
 */
@Module({
  // Ops → Health 방향 의존은 없다 — 복구 판정의 단일 원천을 가져다 쓴다
  // (CTO 결정 2301-①)
  imports: [AuthModule, LlmModule, StorageModule, OpsModule],
  controllers: [HealthController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class HealthModule {}
