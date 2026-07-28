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

  return {
    users,
    sessions,
    user: {
      count: jest.fn(async () => users.size),
      findUnique: jest.fn(async ({ where }: { where: { email: string } }) =>
        [...users.values()].find((user) => user.email === where.email) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Partial<User> }) => {
        const now = new Date();
        const user = {
          id: `user-${++sequence}`,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as User;
        users.set(user.id, user);
        return { ...user };
      }),
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
        async ({ where }: { where: { token: string } }) => {
          sessions.delete(where.token);
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
});
