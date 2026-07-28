import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { AdminController } from "./admin.controller";

/**
 * Provider Administration Console 모듈. (TASK-1201, Sprint 12)
 * 설정 저장소는 전역 AdminSettingsModule이 제공한다 (순환 의존 방지).
 */
@Module({
  imports: [AuthModule, LlmModule],
  controllers: [AdminController],
})
export class AdminModule {}
