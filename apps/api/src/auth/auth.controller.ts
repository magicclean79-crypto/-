import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { buildSessionClearCookie, buildSessionCookie } from "@acos/core";
import type {
  ChangeEmailRequest,
  ChangePasswordRequest,
  CreateUserRequest,
  LoginRequest,
  LoginResponseDto,
  ResetPasswordRequest,
  SignupRequest,
  UpdateUserRequest,
  UserAuditLogDto,
  UserDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "./auth.guard";
import type { AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";
import {
  extractRequestToken,
  isCookieOnly,
  sessionCookieOptions,
} from "./session-config";
import { Public } from "./write-protection.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 로그인 — 세션 토큰 발급 (TTL은 AUTH_SESSION_TTL_HOURS, 기본 7일).
   * httpOnly 쿠키를 발급하고, 개발은 본문 토큰(localStorage) 병행,
   * **쿠키 전용 모드(운영 기본, TASK-0804)에서는 본문 토큰을 제외**한다
   * (CTO 결정 0803-①).
   */
  @Post("login")
  @HttpCode(200)
  @Public()
  async login(
    @Body() body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(
      body ?? ({} as LoginRequest),
    );
    response.setHeader(
      "Set-Cookie",
      buildSessionCookie(result.token as string, sessionCookieOptions()),
    );
    return isCookieOnly() ? { ...result, token: null } : result;
  }

  /**
   * 회원가입 (T1-215, 공개 API) — 항상 VIEWER 역할로 계정을 생성하고
   * 로그인과 동일하게 세션 쿠키를 발급한다. 관리자 권한은 이 경로로
   * 부여되지 않는다.
   */
  @Post("signup")
  @HttpCode(201)
  @Public()
  async signup(
    @Body() body: SignupRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.signup(body ?? ({} as SignupRequest));
    response.setHeader(
      "Set-Cookie",
      buildSessionCookie(result.token as string, sessionCookieOptions()),
    );
    return isCookieOnly() ? { ...result, token: null } : result;
  }

  /** 로그아웃 — 현재 토큰의 세션 폐기 + 쿠키 만료 (모든 역할 가능) */
  @Post("logout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @RequireRole("VIEWER")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    await this.authService.logout(extractRequestToken(request.headers));
    response.setHeader(
      "Set-Cookie",
      buildSessionClearCookie(sessionCookieOptions()),
    );
    return { ok: true };
  }

  /** 현재 로그인 사용자 */
  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest): UserDto {
    return request.user as UserDto;
  }

  /** 비밀번호 변경 — 본인 셀프 서비스, 모든 역할 (TASK-0803, 감사 기록) */
  @Patch("password")
  @UseGuards(AuthGuard)
  @RequireRole("VIEWER")
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() body?: ChangePasswordRequest,
  ): Promise<{ ok: true }> {
    await this.authService.changePassword(
      (request.user as UserDto).id,
      body ?? ({} as ChangePasswordRequest),
      extractRequestToken(request.headers),
    );
    return { ok: true };
  }

  /**
   * 로그인 ID(이메일) 변경 — 본인 셀프 서비스, 모든 역할 (T1-215,
   * 감사 기록). 현재 비밀번호 확인 필요.
   */
  @Patch("email")
  @UseGuards(AuthGuard)
  @RequireRole("VIEWER")
  async changeEmail(
    @Req() request: AuthenticatedRequest,
    @Body() body?: ChangeEmailRequest,
  ): Promise<UserDto> {
    return this.authService.changeEmail(
      (request.user as UserDto).id,
      body ?? ({} as ChangeEmailRequest),
      extractRequestToken(request.headers),
    );
  }

  /** 사용자 목록 — ADMIN 전용 (TASK-0802) */
  @Get("users")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async listUsers(): Promise<{ users: UserDto[] }> {
    return { users: await this.authService.listUsers() };
  }

  /** 사용자 생성 — ADMIN 전용 (RBAC, 감사 기록) */
  @Post("users")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async createUser(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateUserRequest,
  ): Promise<UserDto> {
    return this.authService.createUser(
      body ?? ({} as CreateUserRequest),
      request.user?.email ?? "unknown",
    );
  }

  /** 사용자 수정(역할 변경/비활성화) — ADMIN 전용 (TASK-0802, 감사 기록) */
  @Patch("users/:id")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async updateUser(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body?: UpdateUserRequest,
  ): Promise<UserDto> {
    return this.authService.updateUser(
      id,
      body ?? {},
      request.user?.email ?? "unknown",
    );
  }

  /** 비밀번호 재설정 — ADMIN 전용 (TASK-0803, 대상 세션 전부 폐기·감사 기록) */
  @Post("users/:id/password-reset")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async resetPassword(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body?: ResetPasswordRequest,
  ): Promise<{ ok: true }> {
    await this.authService.resetPassword(
      id,
      body?.newPassword ?? "",
      request.user?.email ?? "unknown",
    );
    return { ok: true };
  }

  /** 사용자 관리 감사 로그 — ADMIN 전용 (TASK-0802, 최신순) */
  @Get("audit")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async listAudit(): Promise<{ audit: UserAuditLogDto[] }> {
    return { audit: await this.authService.listAudit() };
  }
}
