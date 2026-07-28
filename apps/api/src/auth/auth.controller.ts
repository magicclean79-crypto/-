import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  CreateUserRequest,
  LoginRequest,
  LoginResponseDto,
  UserDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "./auth.guard";
import type { AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 로그인 — 세션 토큰 발급 (기본 7일) */
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: LoginRequest): Promise<LoginResponseDto> {
    return this.authService.login(body ?? ({} as LoginRequest));
  }

  /** 로그아웃 — 현재 토큰의 세션 폐기 */
  @Post("logout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
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

  /** 사용자 생성 — ADMIN 전용 (RBAC) */
  @Post("users")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async createUser(@Body() body: CreateUserRequest): Promise<UserDto> {
    return this.authService.createUser(body ?? ({} as CreateUserRequest));
  }
}
