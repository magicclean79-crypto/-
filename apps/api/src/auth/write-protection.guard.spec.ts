import {
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserDto, UserRole } from "@acos/shared";
import { REQUIRED_ROLE_KEY } from "./auth.guard";
import type { AuthService } from "./auth.service";
import { PUBLIC_IN_DEV_KEY, PUBLIC_KEY, WriteProtectionGuard } from "./write-protection.guard";

function user(role: UserRole): UserDto {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@acos.local`,
    name: role,
    role,
    disabled: false,
    lockedUntil: null,
    createdAt: "",
  };
}

const authService = {
  validateToken: async (token: string) =>
    token === "admin-token"
      ? user("ADMIN")
      : token === "editor-token"
        ? user("EDITOR")
        : token === "viewer-token"
          ? user("VIEWER")
          : null,
} as unknown as AuthService;

function contextOf(
  method: string,
  token?: string,
  metadata: Record<string, unknown> = {},
): { context: ExecutionContext; request: { user?: UserDto } } {
  const request = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as { method: string; headers: Record<string, string>; user?: UserDto };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({ metadata }),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("WriteProtectionGuard (전면 쓰기 보호, TASK-0802)", () => {
  function createGuard(metadata: Record<string, unknown> = {}) {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    return new WriteProtectionGuard(authService, reflector);
  }

  it("GET은 인증 없이 통과한다 (조회 비보호 — CTO 결정)", async () => {
    const guard = createGuard();
    const { context } = contextOf("GET");
    expect(await guard.canActivate(context)).toBe(true);
  });

  it("@Public 쓰기 엔드포인트는 통과한다 (로그인·Company Brain 조회 등)", async () => {
    const guard = createGuard({ [PUBLIC_KEY]: true });
    const { context } = contextOf("POST");
    expect(await guard.canActivate(context)).toBe(true);
  });

  it("쓰기 요청은 무토큰 401", async () => {
    const guard = createGuard();
    await expect(
      guard.canActivate(contextOf("POST").context),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      guard.canActivate(contextOf("DELETE", "bad-token").context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("기본 요구 역할은 EDITOR — VIEWER 403, EDITOR/ADMIN 통과 + request.user 주입", async () => {
    const guard = createGuard();
    await expect(
      guard.canActivate(contextOf("POST", "viewer-token").context),
    ).rejects.toThrow(ForbiddenException);

    const editor = contextOf("PATCH", "editor-token");
    expect(await guard.canActivate(editor.context)).toBe(true);
    expect(editor.request.user?.role).toBe("EDITOR");

    expect(
      await guard.canActivate(contextOf("POST", "admin-token").context),
    ).toBe(true);
  });

  it("@RequireRole 메타데이터가 있으면 해당 역할 기준 — ADMIN 요구 시 EDITOR 403", async () => {
    const guard = createGuard({ [REQUIRED_ROLE_KEY]: "ADMIN" });
    await expect(
      guard.canActivate(contextOf("POST", "editor-token").context),
    ).rejects.toThrow(ForbiddenException);
    expect(
      await guard.canActivate(contextOf("POST", "admin-token").context),
    ).toBe(true);
  });

  it("@RequireRole(VIEWER)면 모든 역할 통과 (로그아웃 등)", async () => {
    const guard = createGuard({ [REQUIRED_ROLE_KEY]: "VIEWER" });
    expect(
      await guard.canActivate(contextOf("POST", "viewer-token").context),
    ).toBe(true);
  });

  describe("@PublicInDev (T1-110 — Image Studio 로컬 테스트 전용 우회)", () => {
    const savedNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (savedNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = savedNodeEnv;
      }
    });

    it("개발(NODE_ENV 미설정)에서는 무토큰이어도 통과한다", async () => {
      delete process.env.NODE_ENV;
      const guard = createGuard({ [PUBLIC_IN_DEV_KEY]: true });
      expect(await guard.canActivate(contextOf("POST").context)).toBe(true);
    });

    it("운영(NODE_ENV=production)에서는 그대로 401을 낸다", async () => {
      process.env.NODE_ENV = "production";
      const guard = createGuard({ [PUBLIC_IN_DEV_KEY]: true });
      await expect(
        guard.canActivate(contextOf("POST").context),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("스테이징(NODE_ENV=staging)에서도 그대로 401을 낸다", async () => {
      process.env.NODE_ENV = "staging";
      const guard = createGuard({ [PUBLIC_IN_DEV_KEY]: true });
      await expect(
        guard.canActivate(contextOf("POST").context),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
