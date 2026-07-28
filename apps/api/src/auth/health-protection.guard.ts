import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { roleAtLeast } from "@acos/core";
import type { AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";
import { extractRequestToken, isHealthProtected } from "./session-config";

/**
 * /llm/health 보호 가드 (TASK-0803 — CTO 결정 0802-③).
 *
 * GET이지만 실 Provider 호출·Execution 기록이 발생하므로,
 * 운영/스테이징(NODE_ENV production/staging 또는 AUTH_PROTECT_HEALTH=1)에서는
 * EDITOR 이상 인증을 요구한다. 개발 환경은 비보호 유지.
 */
@Injectable()
export class HealthProtectionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!isHealthProtected()) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.authService.validateToken(
      extractRequestToken(request.headers),
    );
    if (!user) {
      throw new UnauthorizedException(
        "운영/스테이징에서 health 점검은 로그인이 필요합니다.",
      );
    }
    request.user = user;
    if (!roleAtLeast(user.role, "EDITOR")) {
      throw new ForbiddenException(
        `이 작업에는 EDITOR 이상의 권한이 필요합니다 (현재: ${user.role}).`,
      );
    }
    return true;
  }
}
