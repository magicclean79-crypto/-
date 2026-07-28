import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { roleAtLeast } from "@acos/core";
import type { UserDto, UserRole } from "@acos/shared";
import { AuthService } from "./auth.service";

export const REQUIRED_ROLE_KEY = "acos:required-role";

/** RBAC — 핸들러에 최소 요구 역할을 지정한다 (역할 계층 비교) */
export const RequireRole = (role: UserRole) =>
  SetMetadata(REQUIRED_ROLE_KEY, role);

export interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  user?: UserDto;
}

/**
 * 인증 가드 (TASK-0801) — `Authorization: Bearer <token>` 검증 후
 * request.user를 채운다. @RequireRole(...)이 있으면 역할 계층으로 인가한다.
 * 미인증 401 · 권한 부족 403.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";

    const user = await this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException(
        "로그인이 필요합니다 (Authorization: Bearer <token>).",
      );
    }
    request.user = user;

    const required = this.reflector.getAllAndOverride<UserRole | undefined>(
      REQUIRED_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && !roleAtLeast(user.role, required)) {
      throw new ForbiddenException(
        `이 작업에는 ${required} 이상의 권한이 필요합니다 (현재: ${user.role}).`,
      );
    }
    return true;
  }
}
