import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { HealthProtectionGuard } from "./health-protection.guard";
import { WriteProtectionGuard } from "./write-protection.guard";

/**
 * 인증/권한 모듈. (TASK-0801 Foundation · TASK-0802 전면 쓰기 보호)
 *
 * - WriteProtectionGuard(APP_GUARD): 모든 쓰기 API에 인증 강제 —
 *   기본 EDITOR 이상, @Public은 예외(읽기 성격 POST), @RequireRole로
 *   개별 역할 지정 (조회 GET은 비보호 — CTO 결정)
 * - AuthGuard: 보호가 필요한 GET(me·사용자 목록·감사 로그)에 개별 적용
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    HealthProtectionGuard,
    { provide: APP_GUARD, useClass: WriteProtectionGuard },
  ],
  exports: [AuthService, AuthGuard, HealthProtectionGuard],
})
export class AuthModule {}
