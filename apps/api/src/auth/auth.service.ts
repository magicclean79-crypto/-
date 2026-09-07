import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import {
  generateSessionToken,
  hashPassword,
  SlidingWindowRateLimiter,
  validatePasswordComplexity,
  verifyPassword,
} from "@acos/core";
import { USER_ROLES } from "@acos/shared";
import type {
  ChangeEmailRequest,
  ChangePasswordRequest,
  CreateUserRequest,
  LoginRequest,
  LoginResponseDto,
  SignupRequest,
  UpdateUserRequest,
  UserAuditAction,
  UserAuditLogDto,
  UserDto,
} from "@acos/shared";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  lockoutConfig,
  loginRateLimitConfig,
  sessionTtlMs,
  signupRateLimitConfig,
} from "./session-config";

function toDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabled,
    lockedUntil: user.lockedUntil ? user.lockedUntil.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * 인증/권한 Foundation 서비스. (TASK-0801, Sprint 8)
 *
 * - 세션: DB 저장형 토큰 (기본 7일 만료) — Authorization: Bearer <token>
 * - 부트스트랩: 사용자가 하나도 없으면 관리자 1명을 생성한다
 *   (AUTH_ADMIN_EMAIL/AUTH_ADMIN_PASSWORD, 기본 admin@acos.local — 로컬 개발용,
 *   운영에서는 반드시 환경변수로 지정)
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.bootstrapAdmin();
    } catch (error) {
      // DB 미기동 등 — 인증 부트스트랩 실패가 앱 기동을 막지 않는다
      this.logger.warn(
        `관리자 부트스트랩 건너뜀: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** 사용자가 없으면 관리자 1명 생성 (최초 기동용) */
  async bootstrapAdmin(): Promise<void> {
    const count = await this.prisma.user.count();
    if (count > 0) {
      return;
    }
    const email = process.env.AUTH_ADMIN_EMAIL ?? "admin@acos.local";
    const password = process.env.AUTH_ADMIN_PASSWORD ?? "admin1234";
    await this.prisma.user.create({
      data: {
        email,
        name: "관리자",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
      },
    });
    this.logger.log(
      `관리자 계정 부트스트랩: ${email}` +
        (process.env.AUTH_ADMIN_PASSWORD ? "" : " (기본 비밀번호 — 로컬 전용)"),
    );
  }

  // 로그인 Rate Limit (TASK-0804) — 이메일 키 슬라이딩 윈도우 (인메모리 1차 방어)
  private limiter: SlidingWindowRateLimiter | null = null;
  private limiterConfig: { limit: number; windowMs: number } | null = null;

  private rateLimiter(): SlidingWindowRateLimiter {
    const config = loginRateLimitConfig();
    if (
      !this.limiter ||
      this.limiterConfig?.limit !== config.limit ||
      this.limiterConfig?.windowMs !== config.windowMs
    ) {
      this.limiter = new SlidingWindowRateLimiter(config.limit, config.windowMs);
      this.limiterConfig = config;
    }
    return this.limiter;
  }

  // 회원가입 Rate Limit (T1-215) — 로그인과 별도 인스턴스·설정
  private signupLimiter: SlidingWindowRateLimiter | null = null;
  private signupLimiterConfig: { limit: number; windowMs: number } | null =
    null;

  private signupRateLimiterInstance(): SlidingWindowRateLimiter {
    const config = signupRateLimitConfig();
    if (
      !this.signupLimiter ||
      this.signupLimiterConfig?.limit !== config.limit ||
      this.signupLimiterConfig?.windowMs !== config.windowMs
    ) {
      this.signupLimiter = new SlidingWindowRateLimiter(
        config.limit,
        config.windowMs,
      );
      this.signupLimiterConfig = config;
    }
    return this.signupLimiter;
  }

  /**
   * 로그인 (TASK-0804 보호 순서):
   * Rate Limit(429) → 잠금 검사 → 비밀번호 검증(실패 시 카운트·임계 도달 시
   * 잠금·감사) → 비활성 검사 → 성공 시 카운터 초기화 + 세션 발급(TTL env)
   */
  async login(request: LoginRequest): Promise<LoginResponseDto> {
    const email = request.email?.trim().toLowerCase();
    if (!email || !request.password) {
      throw new BadRequestException("email과 password는 필수입니다.");
    }
    if (!this.rateLimiter().attempt(email).allowed) {
      throw new HttpException(
        "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.recordAudit(
        "LOGIN_FAILED",
        email,
        email,
        "잠금 상태에서 로그인 시도",
      );
      throw new UnauthorizedException(
        "로그인 실패가 반복되어 계정이 잠겼습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (!user || !(await verifyPassword(request.password, user.passwordHash))) {
      if (user) {
        await this.handleFailedLogin(user, now);
      }
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }
    if (user.disabled) {
      await this.recordAudit("LOGIN_FAILED", email, email, "비활성화된 계정");
      throw new UnauthorizedException("비활성화된 계정입니다.");
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    this.rateLimiter().reset(email);

    const session = await this.prisma.authSession.create({
      data: {
        token: generateSessionToken(),
        userId: user.id,
        expiresAt: new Date(Date.now() + sessionTtlMs()),
      },
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: toDto(user),
    };
  }

  /**
   * 자체 회원가입 (T1-215, 공개 API) — 항상 VIEWER 역할로 계정을 만들고
   * 즉시 로그인시킨다(로그인과 동일한 세션 발급 경로). 관리자 권한은
   * 이 경로로 절대 부여되지 않는다(`POST /auth/users`만 role을 받음,
   * ADMIN 전용).
   */
  async signup(request: SignupRequest): Promise<LoginResponseDto> {
    const email = request.email?.trim().toLowerCase();
    const name = request.name?.trim();
    if (!email || !name || !request.password) {
      throw new BadRequestException("email·name·password는 필수입니다.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException("올바른 이메일 형식이 아닙니다.");
    }
    if (!this.signupRateLimiterInstance().attempt(email).allowed) {
      throw new HttpException(
        "가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const violation = validatePasswordComplexity(request.password);
    if (violation) {
      throw new BadRequestException(violation);
    }
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw new ConflictException(`이미 존재하는 이메일입니다: ${email}`);
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(request.password),
        role: "VIEWER",
      },
    });
    await this.recordAudit("USER_SIGNED_UP", email, email);

    const session = await this.prisma.authSession.create({
      data: {
        token: generateSessionToken(),
        userId: user.id,
        expiresAt: new Date(Date.now() + sessionTtlMs()),
      },
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: toDto(user),
    };
  }

  /** 실패 카운트 증가 + 임계 도달 시 잠금 (TASK-0804 Account Lockout) */
  private async handleFailedLogin(user: User, now: Date): Promise<void> {
    const { threshold, lockMs } = lockoutConfig();
    const failedCount = user.failedLoginCount + 1;
    const lock = failedCount >= threshold;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failedCount,
        ...(lock ? { lockedUntil: new Date(now.getTime() + lockMs) } : {}),
      },
    });
    await this.recordAudit(
      "LOGIN_FAILED",
      user.email,
      user.email,
      `잘못된 비밀번호 (${failedCount}/${threshold})`,
    );
    if (lock) {
      await this.recordAudit(
        "ACCOUNT_LOCKED",
        user.email,
        user.email,
        `연속 ${failedCount}회 실패 — ${Math.round(lockMs / 60_000)}분 잠금`,
      );
    }
  }

  async logout(token: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { token } });
  }

  /** Bearer 토큰 → 사용자 (만료/무효 시 null) — AuthGuard가 사용 */
  async validateToken(token: string): Promise<UserDto | null> {
    if (!token) {
      return null;
    }
    const session = await this.prisma.authSession.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.disabled) {
      return null;
    }
    return toDto(session.user);
  }

  /** 사용자 관리 감사 로그 기록 (TASK-0802) */
  private async recordAudit(
    action: UserAuditAction,
    actor: string,
    targetEmail: string,
    detail: string | null = null,
  ): Promise<void> {
    await this.prisma.userAuditLog.create({
      data: { action, actor, targetEmail, detail },
    });
  }

  /** 사용자 목록 (ADMIN 전용) — 생성순 */
  async listUsers(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    });
    return users.map(toDto);
  }

  /**
   * 사용자 수정 (ADMIN 전용, TASK-0802) — 역할 변경/비활성화.
   * 자기 자신은 수정 불가(마지막 관리자 강등·자기 비활성화 방지),
   * 비활성화 시 해당 사용자의 모든 세션을 즉시 폐기한다.
   */
  async updateUser(
    id: string,
    request: UpdateUserRequest,
    actor: string,
  ): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new BadRequestException(`사용자를 찾을 수 없습니다: ${id}`);
    }
    if (user.email === actor) {
      throw new BadRequestException(
        "자기 자신의 역할/활성 상태는 변경할 수 없습니다.",
      );
    }
    if (request.role !== undefined && !USER_ROLES.includes(request.role)) {
      throw new BadRequestException(
        `role은 다음 중 하나여야 합니다: ${USER_ROLES.join(", ")}`,
      );
    }
    if (request.role === undefined && request.disabled === undefined) {
      throw new BadRequestException("role 또는 disabled를 지정해 주세요.");
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(request.role !== undefined ? { role: request.role } : {}),
        ...(request.disabled !== undefined
          ? { disabled: request.disabled }
          : {}),
      },
    });

    if (request.role !== undefined && request.role !== user.role) {
      await this.recordAudit(
        "ROLE_CHANGED",
        actor,
        user.email,
        `${user.role} → ${request.role}`,
      );
    }
    if (request.disabled !== undefined && request.disabled !== user.disabled) {
      await this.recordAudit(
        request.disabled ? "USER_DISABLED" : "USER_ENABLED",
        actor,
        user.email,
      );
      if (request.disabled) {
        // 비활성화 즉시 세션 전부 폐기
        await this.prisma.authSession.deleteMany({ where: { userId: id } });
      }
    }
    return toDto(updated);
  }

  /**
   * 비밀번호 변경 (TASK-0803) — 본인 셀프 서비스, 모든 역할 가능.
   * 현재 비밀번호 확인 후 변경하고, 현재 세션만 남기고 나머지 세션을
   * 전부 폐기한다 (탈취된 다른 기기 세션 차단 — 운영 보안).
   */
  async changePassword(
    userId: string,
    request: ChangePasswordRequest,
    currentToken: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("로그인이 필요합니다.");
    }
    if (
      !request.currentPassword ||
      !(await verifyPassword(request.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException("현재 비밀번호가 올바르지 않습니다.");
    }
    this.assertNewPassword(request.newPassword, request.currentPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(request.newPassword) },
    });
    await this.prisma.authSession.deleteMany({
      where: { userId, token: { not: currentToken } },
    });
    await this.recordAudit("PASSWORD_CHANGED", user.email, user.email);
  }

  /**
   * 로그인 ID(이메일) 변경 (T1-215) — 본인 셀프 서비스, 모든 역할.
   * 현재 비밀번호를 확인해야만 바꿀 수 있고(계정 탈취 방지), 대상
   * 이메일이 이미 다른 계정에서 쓰이고 있으면 거부한다. 비밀번호
   * 변경과 동일하게 현재 세션만 남기고 나머지 세션은 전부 폐기한다 —
   * 로그인 ID가 곧 다른 기기의 세션이 아직 신뢰할 이유가 되지 않는다.
   */
  async changeEmail(
    userId: string,
    request: ChangeEmailRequest,
    currentToken: string,
  ): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("로그인이 필요합니다.");
    }
    if (
      !request.currentPassword ||
      !(await verifyPassword(request.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException("현재 비밀번호가 올바르지 않습니다.");
    }
    const newEmail = request.newEmail?.trim().toLowerCase();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new BadRequestException("올바른 이메일 형식이 아닙니다.");
    }
    if (newEmail === user.email) {
      throw new BadRequestException(
        "새 이메일이 현재 이메일과 동일합니다.",
      );
    }
    const exists = await this.prisma.user.findUnique({
      where: { email: newEmail },
    });
    if (exists) {
      throw new ConflictException(`이미 사용 중인 이메일입니다: ${newEmail}`);
    }

    const previousEmail = user.email;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { email: newEmail },
    });
    await this.prisma.authSession.deleteMany({
      where: { userId, token: { not: currentToken } },
    });
    await this.recordAudit(
      "EMAIL_CHANGED",
      previousEmail,
      newEmail,
      `${previousEmail} → ${newEmail}`,
    );
    return toDto(updated);
  }

  /**
   * 비밀번호 재설정 (TASK-0803, ADMIN 전용) — 대상 사용자에게 새 비밀번호를
   * 지정한다. 자기 자신은 불가(변경 기능 사용), 대상의 모든 세션을 폐기한다.
   */
  async resetPassword(
    id: string,
    newPassword: string,
    actor: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new BadRequestException(`사용자를 찾을 수 없습니다: ${id}`);
    }
    if (user.email === actor) {
      throw new BadRequestException(
        "자기 자신은 비밀번호 변경(현재 비밀번호 확인)을 사용해 주세요.",
      );
    }
    this.assertNewPassword(newPassword);

    await this.prisma.user.update({
      where: { id },
      // 재설정은 잠금/실패 카운트도 해제한다 (TASK-0804 — ADMIN 복구 경로)
      data: {
        passwordHash: await hashPassword(newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.prisma.authSession.deleteMany({ where: { userId: id } });
    await this.recordAudit("PASSWORD_RESET", actor, user.email);
  }

  private assertNewPassword(
    newPassword: string | undefined,
    currentPassword?: string,
  ): void {
    // 복잡도 정책 (TASK-0804): 최소 8자 + 영문 + 숫자 — core 단일 정의
    const violation = validatePasswordComplexity(newPassword);
    if (violation) {
      throw new BadRequestException(violation);
    }
    if (currentPassword !== undefined && newPassword === currentPassword) {
      throw new BadRequestException(
        "새 비밀번호가 현재 비밀번호와 동일합니다.",
      );
    }
  }

  /** 사용자 관리 감사 로그 (ADMIN 전용) — 최신순 */
  async listAudit(): Promise<UserAuditLogDto[]> {
    const records = await this.prisma.userAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return records.map((record) => ({
      id: record.id,
      actor: record.actor,
      action: record.action as UserAuditAction,
      targetEmail: record.targetEmail,
      detail: record.detail,
      createdAt: record.createdAt.toISOString(),
    }));
  }

  /** 사용자 생성 (ADMIN 전용 — 컨트롤러에서 RBAC 강제) */
  async createUser(request: CreateUserRequest, actor: string): Promise<UserDto> {
    const email = request.email?.trim().toLowerCase();
    if (!email || !request.name?.trim()) {
      throw new BadRequestException("email과 name은 필수입니다.");
    }
    if (!USER_ROLES.includes(request.role)) {
      throw new BadRequestException(
        `role은 다음 중 하나여야 합니다: ${USER_ROLES.join(", ")}`,
      );
    }
    // 복잡도 정책 (TASK-0804) — 생성·변경·재설정 공통
    const violation = validatePasswordComplexity(request.password);
    if (violation) {
      throw new BadRequestException(violation);
    }
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw new ConflictException(`이미 존재하는 이메일입니다: ${email}`);
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: request.name.trim(),
        passwordHash: await hashPassword(request.password),
        role: request.role,
      },
    });
    await this.recordAudit("USER_CREATED", actor, email, `role=${request.role}`);
    return toDto(user);
  }
}
