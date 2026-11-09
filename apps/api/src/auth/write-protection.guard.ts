import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { roleAtLeast } from "@acos/core";
import type { UserRole } from "@acos/shared";
import { REQUIRED_ROLE_KEY } from "./auth.guard";
import type { AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";
import { extractRequestToken, isOperationalEnv } from "./session-config";

export const PUBLIC_KEY = "acos:public";

/** 쓰기 메서드여도 인증을 요구하지 않는 엔드포인트 표시 (읽기 성격의 POST 등) */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PUBLIC_IN_DEV_KEY = "acos:public-in-dev";

/**
 * 개발 환경(NODE_ENV가 production/staging이 아닐 때)에서만 인증을
 * 우회한다 (T1-110 — Image Studio 로컬 테스트 로그인 요구 제거).
 * `@Public()`과 달리 운영/스테이징에서는 그대로 인증을 요구한다 —
 * 실 과금(LLM 호출)이 걸린 엔드포인트를 인터넷에 공개하지 않기 위함.
 */
export const PublicInDev = () => SetMetadata(PUBLIC_IN_DEV_KEY, true);

const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

/** 전면 쓰기 보호의 기본 요구 역할 — @RequireRole로 개별 상향/하향 가능 */
export const DEFAULT_WRITE_ROLE: UserRole = "EDITOR";

/**
 * 전역 쓰기 보호 가드 (TASK-0802 — CTO 지시 "모든 Write API 인증").
 *
 * APP_GUARD로 등록되어 모든 POST/PATCH/PUT/DELETE에 인증을 강제한다:
 * - GET/HEAD/OPTIONS: 통과 (조회 API는 비보호 — CTO 결정 0801 승인 ①)
 * - @Public(): 통과 — 읽기 성격의 POST(로그인·Company Brain 조회·READY 검증)
 * - @PublicInDev(): 운영/스테이징이 아닐 때만 통과 (T1-110 — Image Studio
 *   로컬 테스트 전용, 운영에서는 그대로 인증을 요구한다)
 * - 그 외 쓰기: Bearer 검증 + 기본 EDITOR 이상 (@RequireRole로 개별 지정 시
 *   해당 역할 기준 — 예: 사용자 관리 ADMIN, 로그아웃 VIEWER)
 */
@Injectable()
export class WriteProtectionGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & { method: string }
    >();
    if (!WRITE_METHODS.includes(request.method)) {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isPublicInDev = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_IN_DEV_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublicInDev && !isOperationalEnv()) {
      return true;
    }

    // Bearer 헤더 우선, 없으면 httpOnly 쿠키 (TASK-0803 운영 쿠키 세션)
    const user = await this.authService.validateToken(
      extractRequestToken(request.headers),
    );
    if (!user) {
      throw new UnauthorizedException(
        "로그인이 필요합니다 (Authorization: Bearer <token>).",
      );
    }
    request.user = user;

    const required =
      this.reflector.getAllAndOverride<UserRole | undefined>(
        REQUIRED_ROLE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? DEFAULT_WRITE_ROLE;
    if (!roleAtLeast(user.role, required)) {
      throw new ForbiddenException(
        `이 작업에는 ${required} 이상의 권한이 필요합니다 (현재: ${user.role}).`,
      );
    }
    return true;
  }
}
