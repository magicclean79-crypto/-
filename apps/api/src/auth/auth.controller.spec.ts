import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { AuthSession, User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

function createPrismaMock() {
  const users = new Map<string, User>();
  const sessions = new Map<string, AuthSession>();
  let sequence = 0;

  const auditLog: Record<string, unknown>[] = [];

  return {
    users,
    sessions,
    auditLog,
    user: {
      count: jest.fn(async () => users.size),
      findUnique: jest.fn(
        async ({ where }: { where: { email?: string; id?: string } }) => {
          const found = where.id
            ? users.get(where.id)
            : [...users.values()].find((user) => user.email === where.email);
          return found ? { ...found } : null; // 실제 Prisma처럼 스냅샷 반환
        },
      ),
      findMany: jest.fn(async () =>
        [...users.values()].map((user) => ({ ...user })),
      ),
      create: jest.fn(async ({ data }: { data: Partial<User> }) => {
        const now = new Date();
        const user = {
          id: `user-${++sequence}`,
          disabled: false,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as User;
        users.set(user.id, user);
        return { ...user };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<User>;
        }) => {
          const user = users.get(where.id) as User;
          Object.assign(user, data, { updatedAt: new Date() });
          return { ...user };
        },
      ),
    },
    userAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `audit-${auditLog.length + 1}`, createdAt: new Date(), ...data };
        auditLog.push(row);
        return { ...row };
      }),
      findMany: jest.fn(async () => [...auditLog].reverse()),
    },
    authSession: {
      create: jest.fn(async ({ data }: { data: Partial<AuthSession> }) => {
        const session = {
          id: `sess-${++sequence}`,
          createdAt: new Date(),
          ...data,
        } as AuthSession;
        sessions.set(session.token, session);
        return { ...session };
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { token: string } }) => {
          const session = sessions.get(where.token);
          if (!session) return null;
          return { ...session, user: users.get(session.userId) };
        },
      ),
      deleteMany: jest.fn(
        async ({
          where,
        }: {
          where: { token?: string | { not: string }; userId?: string };
        }) => {
          if (typeof where.token === "string") {
            sessions.delete(where.token);
            return { count: 1 };
          }
          // { userId, token: { not } } — 현재 세션만 남기고 폐기 (TASK-0803)
          const keep =
            typeof where.token === "object" ? where.token.not : null;
          if (where.userId) {
            for (const [token, session] of sessions) {
              if (session.userId === where.userId && token !== keep) {
                sessions.delete(token);
              }
            }
          }
          return { count: 1 };
        },
      ),
    },
  };
}

describe("Auth API (TASK-0801)", () => {
  let app: INestApplication;
  let service: AuthService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        AuthGuard,
        { provide: PrismaService, useValue: createPrismaMock() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = moduleRef.get(AuthService);
    await service.bootstrapAdmin(); // 사용자 0명 → 관리자 생성
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password });
  }

  it("부트스트랩 관리자로 로그인 — 세션 토큰 발급", async () => {
    const response = await login("admin@acos.local", "admin1234");

    expect(response.status).toBe(200);
    expect(response.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(response.body.user).toMatchObject({
      email: "admin@acos.local",
      role: "ADMIN",
    });
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("잘못된 비밀번호·없는 계정은 401 (동일 메시지)", async () => {
    expect((await login("admin@acos.local", "wrong-pass")).status).toBe(401);
    expect((await login("nope@acos.local", "admin1234")).status).toBe(401);
  });

  it("GET /auth/me — 토큰으로 본인 확인, 무토큰 401", async () => {
    const { body } = await login("admin@acos.local", "admin1234");

    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${body.token}`)
      .expect(200);
    expect(me.body.email).toBe("admin@acos.local");

    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("로그아웃하면 토큰이 무효화된다", async () => {
    const { body } = await login("admin@acos.local", "admin1234");

    await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Authorization", `Bearer ${body.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${body.token}`)
      .expect(401);
  });

  it("사용자 생성은 ADMIN 전용(RBAC) — 생성된 EDITOR는 로그인 가능, users 생성은 403", async () => {
    const admin = (await login("admin@acos.local", "admin1234")).body;

    // ADMIN이 EDITOR 생성
    await request(app.getHttpServer())
      .post("/auth/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        email: "editor@acos.local",
        name: "에디터",
        password: "editor-pass-1",
        role: "EDITOR",
      })
      .expect(201);

    // 중복 이메일 409, 짧은 비밀번호 400
    await request(app.getHttpServer())
      .post("/auth/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        email: "editor@acos.local",
        name: "에디터",
        password: "editor-pass-1",
        role: "EDITOR",
      })
      .expect(409);
    await request(app.getHttpServer())
      .post("/auth/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "x@acos.local", name: "x", password: "short", role: "VIEWER" })
      .expect(400);

    // EDITOR 로그인 → users 생성은 ADMIN 전용이므로 403
    const editor = (await login("editor@acos.local", "editor-pass-1")).body;
    expect(editor.user.role).toBe("EDITOR");
    await request(app.getHttpServer())
      .post("/auth/users")
      .set("Authorization", `Bearer ${editor.token}`)
      .send({
        email: "y@acos.local",
        name: "y",
        password: "password-1",
        role: "VIEWER",
      })
      .expect(403);
  });

  it("사용자 목록/역할 변경/비활성화 — ADMIN 전용 + 감사 기록 (TASK-0802)", async () => {
    const admin = (await login("admin@acos.local", "admin1234")).body;

    // 목록 (EDITOR는 403)
    const list = await request(app.getHttpServer())
      .get("/auth/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .expect(200);
    const editorRow = list.body.users.find(
      (item: { email: string }) => item.email === "editor@acos.local",
    );
    expect(editorRow).toMatchObject({ role: "EDITOR", disabled: false });
    const editorLogin = (await login("editor@acos.local", "editor-pass-1"))
      .body;
    await request(app.getHttpServer())
      .get("/auth/users")
      .set("Authorization", `Bearer ${editorLogin.token}`)
      .expect(403);

    // 역할 변경 EDITOR → VIEWER
    const changed = await request(app.getHttpServer())
      .patch(`/auth/users/${editorRow.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "VIEWER" })
      .expect(200);
    expect(changed.body.role).toBe("VIEWER");

    // 비활성화 → 기존 세션 즉시 무효 + 재로그인 401
    await request(app.getHttpServer())
      .patch(`/auth/users/${editorRow.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ disabled: true })
      .expect(200);
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${editorLogin.token}`)
      .expect(401);
    expect(
      (await login("editor@acos.local", "editor-pass-1")).status,
    ).toBe(401); // 비활성화된 계정

    // 자기 자신 변경은 400
    const self = list.body.users.find(
      (item: { email: string }) => item.email === "admin@acos.local",
    );
    await request(app.getHttpServer())
      .patch(`/auth/users/${self.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ disabled: true })
      .expect(400);

    // 감사 로그 — 최신순으로 기록 확인
    const audit = await request(app.getHttpServer())
      .get("/auth/audit")
      .set("Authorization", `Bearer ${admin.token}`)
      .expect(200);
    const actions = audit.body.audit.map(
      (item: { action: string; targetEmail: string }) =>
        `${item.action}:${item.targetEmail}`,
    );
    expect(actions[0]).toBe("USER_DISABLED:editor@acos.local");
    expect(actions[1]).toBe("ROLE_CHANGED:editor@acos.local");
    expect(actions).toContain("USER_CREATED:editor@acos.local");
    expect(audit.body.audit[0].actor).toBe("admin@acos.local");
  });

  it("비밀번호 변경 — 본인 확인·다른 세션 폐기·감사 기록 (TASK-0803)", async () => {
    const admin = (await login("admin@acos.local", "admin1234")).body;
    await request(app.getHttpServer())
      .post("/auth/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        email: "pw@acos.local",
        name: "비번",
        password: "pw-pass-11",
        role: "EDITOR",
      })
      .expect(201);

    const sessA = (await login("pw@acos.local", "pw-pass-11")).body;
    const sessB = (await login("pw@acos.local", "pw-pass-11")).body;

    const change = (body: object, token: string) =>
      request(app.getHttpServer())
        .patch("/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    // 현재 비밀번호 오류·짧은 새 비밀번호·동일 비밀번호 → 400
    await change(
      { currentPassword: "wrong", newPassword: "new-pass-11" },
      sessA.token,
    ).expect(400);
    await change(
      { currentPassword: "pw-pass-11", newPassword: "short" },
      sessA.token,
    ).expect(400);
    await change(
      { currentPassword: "pw-pass-11", newPassword: "pw-pass-11" },
      sessA.token,
    ).expect(400);
    // 무토큰 401
    await request(app.getHttpServer())
      .patch("/auth/password")
      .send({ currentPassword: "pw-pass-11", newPassword: "new-pass-11" })
      .expect(401);

    await change(
      { currentPassword: "pw-pass-11", newPassword: "new-pass-11" },
      sessA.token,
    ).expect(200);

    // 현재 세션은 유지, 다른 세션은 폐기
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${sessA.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${sessB.token}`)
      .expect(401);

    // 이전 비밀번호 401 · 새 비밀번호 200
    expect((await login("pw@acos.local", "pw-pass-11")).status).toBe(401);
    expect((await login("pw@acos.local", "new-pass-11")).status).toBe(200);

    const audit = await request(app.getHttpServer())
      .get("/auth/audit")
      .set("Authorization", `Bearer ${admin.token}`)
      .expect(200);
    expect(audit.body.audit[0]).toMatchObject({
      action: "PASSWORD_CHANGED",
      actor: "pw@acos.local",
      targetEmail: "pw@acos.local",
    });
  });

  it("비밀번호 재설정 — ADMIN 전용·전 세션 폐기·자기 자신 불가 (TASK-0803)", async () => {
    const admin = (await login("admin@acos.local", "admin1234")).body;
    const list = await request(app.getHttpServer())
      .get("/auth/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .expect(200);
    const target = list.body.users.find(
      (item: { email: string }) => item.email === "pw@acos.local",
    );
    const self = list.body.users.find(
      (item: { email: string }) => item.email === "admin@acos.local",
    );

    // EDITOR는 403 (ADMIN 전용)
    const editor = (await login("pw@acos.local", "new-pass-11")).body;
    await request(app.getHttpServer())
      .post(`/auth/users/${target.id}/password-reset`)
      .set("Authorization", `Bearer ${editor.token}`)
      .send({ newPassword: "reset-pass-11" })
      .expect(403);

    // 짧은 비밀번호 400 · 자기 자신 400
    await request(app.getHttpServer())
      .post(`/auth/users/${target.id}/password-reset`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ newPassword: "short" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/auth/users/${self.id}/password-reset`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ newPassword: "reset-pass-11" })
      .expect(400);

    // 재설정 성공 → 대상의 모든 세션 폐기 + 새 비밀번호로만 로그인
    await request(app.getHttpServer())
      .post(`/auth/users/${target.id}/password-reset`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ newPassword: "reset-pass-11" })
      .expect(200);
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${editor.token}`)
      .expect(401);
    expect((await login("pw@acos.local", "new-pass-11")).status).toBe(401);
    expect((await login("pw@acos.local", "reset-pass-11")).status).toBe(200);

    const audit = await request(app.getHttpServer())
      .get("/auth/audit")
      .set("Authorization", `Bearer ${admin.token}`)
      .expect(200);
    expect(audit.body.audit[0]).toMatchObject({
      action: "PASSWORD_RESET",
      actor: "admin@acos.local",
      targetEmail: "pw@acos.local",
    });
  });

  it("쿠키 세션 — httpOnly 발급·쿠키 인증·로그아웃 시 만료 (TASK-0803)", async () => {
    const response = await login("admin@acos.local", "admin1234");
    const setCookie = String(response.headers["set-cookie"]?.[0] ?? "");
    expect(setCookie).toContain(`acos_session=${response.body.token}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax"); // 기본값 (개발)

    // Bearer 없이 쿠키만으로 인증
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", `acos_session=${response.body.token}`)
      .expect(200);

    // 로그아웃 → 세션 폐기 + 쿠키 즉시 만료(Max-Age=0)
    const logout = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", `acos_session=${response.body.token}`)
      .expect(200);
    expect(String(logout.headers["set-cookie"]?.[0] ?? "")).toContain(
      "Max-Age=0",
    );
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", `acos_session=${response.body.token}`)
      .expect(401);
  });
});
