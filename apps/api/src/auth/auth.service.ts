import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import {
  generateSessionToken,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_MS,
  verifyPassword,
} from "@acos/core";
import { USER_ROLES } from "@acos/shared";
import type {
  CreateUserRequest,
  LoginRequest,
  LoginResponseDto,
  UpdateUserRequest,
  UserAuditAction,
  UserAuditLogDto,
  UserDto,
} from "@acos/shared";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

function toDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabled,
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

  async login(request: LoginRequest): Promise<LoginResponseDto> {
    const email = request.email?.trim().toLowerCase();
    if (!email || !request.password) {
      throw new BadRequestException("email과 password는 필수입니다.");
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(request.password, user.passwordHash))) {
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }
    if (user.disabled) {
      throw new UnauthorizedException("비활성화된 계정입니다.");
    }

    const session = await this.prisma.authSession.create({
      data: {
        token: generateSessionToken(),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: toDto(user),
    };
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
    if ((request.password ?? "").length < PASSWORD_MIN_LENGTH) {
      throw new BadRequestException(
        `password는 최소 ${PASSWORD_MIN_LENGTH}자여야 합니다.`,
      );
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
