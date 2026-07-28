import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

/**
 * 인증/권한 Foundation 모듈. (TASK-0801, Sprint 8)
 * AuthGuard + @RequireRole로 보호가 필요한 엔드포인트에 개별 적용한다
 * — 이번 TASK 적용 범위: 발행 파이프라인 전이(Actor Audit 연계)와
 * 사용자 관리. 전면 강제 범위는 CTO 결정 대기.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
