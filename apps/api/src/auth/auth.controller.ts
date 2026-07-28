import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  CreateUserRequest,
  LoginRequest,
  LoginResponseDto,
  UpdateUserRequest,
  UserAuditLogDto,
  UserDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "./auth.guard";
import type { AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";
import { Public } from "./write-protection.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 로그인 — 세션 토큰 발급 (기본 7일) */
  @Post("login")
  @HttpCode(200)
  @Public()
  async login(@Body() body: LoginRequest): Promise<LoginResponseDto> {
    return this.authService.login(body ?? ({} as LoginRequest));
  }

  /** 로그아웃 — 현재 토큰의 세션 폐기 (모든 역할 가능) */
  @Post("logout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @RequireRole("VIEWER")
  async logout(@Req() request: AuthenticatedRequest): Promise<{ ok: true }> {
    const header = request.headers["authorization"] ?? "";
    await this.authService.logout(
      header.startsWith("Bearer ") ? header.slice(7) : "",
    );
    return { ok: true };
  }

  /** 현재 로그인 사용자 */
  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest): UserDto {
    return request.user as UserDto;
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

  /** 사용자 관리 감사 로그 — ADMIN 전용 (TASK-0802, 최신순) */
  @Get("audit")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async listAudit(): Promise<{ audit: UserAuditLogDto[] }> {
    return { audit: await this.authService.listAudit() };
  }
}
