import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminSettingsService } from "./admin-settings.service";
import { AdminController } from "./admin.controller";

/**
 * Provider Administration Console 검증. (TASK-1201, Sprint 12)
 *
 * 설정 원칙은 **Code-first(환경변수)** 이고 콘솔은 그 위의 오버라이드다.
 * 여기서는 ① 각 값의 출처가 정확히 보이는지 ② 검증이 저장 시점에 막는지
 * ③ 모든 변경이 감사로 남는지 ④ ADMIN 전용인지를 확인한다.
 */
describe("Provider Administration Console (TASK-1201)", () => {
  let app: INestApplication;
  let settings: AdminSettingsService;
  const rows = new Map<string, { key: string; value: string; updatedBy: string | null }>();
  const audit: Record<string, unknown>[] = [];

  beforeAll(async () => {
    process.env.LLM_DAILY_BUDGET_USD = "10";
    process.env.LLM_MODEL_ANALYSIS = "gpt-4o-mini";

    const prisma = {
      adminSetting: {
        findMany: async () => [...rows.values()],
        upsert: async ({ where, create }: { where: { key: string }; create: { key: string; value: string; updatedBy: string | null } }) => {
          rows.set(where.key, { ...create });
          return create;
        },
        deleteMany: async ({ where }: { where: { key: string } }) => {
          rows.delete(where.key);
          return { count: 1 };
        },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          audit.unshift({ ...data, id: `a-${audit.length + 1}`, createdAt: new Date() });
          return data;
        },
        findMany: async () => audit,
      },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AdminSettingsService,
        {
          provide: LlmService,
          useFactory: (settingsService: AdminSettingsService) => ({
            // 실제 LlmService와 같은 규칙으로 활성 Provider를 계산한다 —
            // 그래야 "마지막 하나는 끌 수 없다"를 진짜로 검증할 수 있다
            routing: () => ({
              availableProviders: ["mock", "openai"].filter(
                (name) =>
                  settingsService.get(`provider.${name}.enabled`) !== "false",
              ),
              routes: [
                { feature: "product-analysis", model: "gpt-4o-mini" },
                { feature: "content-generation", model: null },
                { feature: "vision-analysis", model: null },
              ],
            }),
          }),
          inject: [AdminSettingsService],
        },
        {
          provide: LlmBudgetService,
          useValue: {
            status: async () => ({
              daily: { budget: 10, spend: 1, ratio: 0.1, status: "ok" },
              monthly: { budget: null, spend: 1, ratio: null, status: "off" },
              alertRatio: 0.8,
              checkedAt: new Date().toISOString(),
            }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateToken: async (token: string) =>
              token === "tok-admin"
                ? { id: "u-a", email: "admin@acos.local", role: "ADMIN" }
                : token === "tok-editor"
                  ? { id: "u-e", email: "e@acos.local", role: "EDITOR" }
                  : null,
          },
        },
        { provide: APP_GUARD, useClass: WriteProtectionGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    settings = moduleRef.get(AdminSettingsService);
    await settings.refresh();
  });

  afterAll(async () => {
    delete process.env.LLM_DAILY_BUDGET_USD;
    delete process.env.LLM_MODEL_ANALYSIS;
    await app.close();
  });

  const admin = (method: "get" | "put", url: string) =>
    request(app.getHttpServer())[method](url).set(
      "Authorization",
      "Bearer tok-admin",
    );

  it("콘솔 현황 — Provider·모델·예산·실험과 각 값의 출처를 제공한다", async () => {
    const response = await admin("get", "/admin/console").expect(200);

    // Provider: Registry 전체 + 활성/사용 가능 여부
    const openai = response.body.providers.find(
      (item: { name: string }) => item.name === "openai",
    );
    expect(openai).toMatchObject({ enabled: true, available: true });
    expect(
      response.body.providers.find(
        (item: { name: string }) => item.name === "gemini",
      ),
    ).toMatchObject({ available: false });

    // 모델: 환경변수 출처가 드러난다
    const analysis = response.body.models.find(
      (item: { feature: string }) => item.feature === "product-analysis",
    );
    expect(analysis.setting).toMatchObject({
      value: "gpt-4o-mini",
      source: "env",
      env: "LLM_MODEL_ANALYSIS",
    });
    expect(analysis.effective).toBe("gpt-4o-mini");

    // 예산: 환경변수 + 기본값(alertRatio)
    expect(response.body.budget.daily).toMatchObject({
      value: "10",
      source: "env",
    });
    expect(response.body.budget.alertRatio).toMatchObject({
      value: "0.8",
      source: "default",
    });
    expect(response.body.budget.status.daily.budget).toBe(10);
    expect(response.body.experiments).toHaveLength(3);
  });

  it("설정 변경 — 오버라이드가 환경변수보다 우선하고 감사로 남는다", async () => {
    await admin("put", "/admin/settings/budget.daily")
      .send({ value: "25", note: "월말 프로모션" })
      .expect(200);

    expect(settings.get("budget.daily")).toBe("25");
    const response = await admin("get", "/admin/console").expect(200);
    expect(response.body.budget.daily).toMatchObject({
      value: "25",
      source: "override",
      fallback: "10", // 해제하면 환경변수로 되돌아간다
    });

    const log = await admin("get", "/admin/audit").expect(200);
    expect(log.body[0]).toMatchObject({
      action: "SETTING_UPDATED",
      key: "budget.daily",
      before: null,
      after: "25",
      actor: "admin@acos.local",
      note: "월말 프로모션",
    });
  });

  it("설정 해제 — null이면 환경변수 값으로 되돌아간다", async () => {
    await admin("put", "/admin/settings/budget.daily")
      .send({ value: "25" })
      .expect(200);
    await admin("put", "/admin/settings/budget.daily")
      .send({ value: null })
      .expect(200);

    expect(settings.get("budget.daily")).toBeNull();
    const response = await admin("get", "/admin/console").expect(200);
    expect(response.body.budget.daily).toMatchObject({
      value: "10",
      source: "env",
    });
    const log = await admin("get", "/admin/audit").expect(200);
    expect(log.body[0]).toMatchObject({
      action: "SETTING_CLEARED",
      after: null,
    });
  });

  it("Provider Enable/Disable — 끄면 라우팅 후보에서 빠진다", async () => {
    await admin("put", "/admin/settings/provider.openai.enabled")
      .send({ value: "false" })
      .expect(200);
    expect(settings.get("provider.openai.enabled")).toBe("false");

    const response = await admin("get", "/admin/console").expect(200);
    expect(
      response.body.providers.find(
        (item: { name: string }) => item.name === "openai",
      ),
    ).toMatchObject({ enabled: false });

    await admin("put", "/admin/settings/provider.openai.enabled")
      .send({ value: null })
      .expect(200);
  });

  it("검증 — 잘못된 값은 저장 시점에 400으로 막는다", async () => {
    await admin("put", "/admin/settings/budget.daily")
      .send({ value: "-5" })
      .expect(400);
    await admin("put", "/admin/settings/provider.openai.enabled")
      .send({ value: "maybe" })
      .expect(400);
    await admin("put", "/admin/settings/experiment.product-analysis")
      .send({ value: "=,=" })
      .expect(400);
    await admin("put", "/admin/settings/model.unknown-feature")
      .send({ value: "gpt-4o" })
      .expect(400);
    await admin("put", "/admin/settings/random.key")
      .send({ value: "1" })
      .expect(400);
    // 잘못된 요청은 저장도 감사도 남지 않는다
    expect(settings.get("budget.daily")).toBeNull();
  });

  it("실험 정의 — 해석 가능한 값은 저장된다 (Experiment Management)", async () => {
    await admin("put", "/admin/settings/experiment.product-analysis")
      .send({ value: "console-canary|canary|mock=90,openai=10" })
      .expect(200);
    expect(settings.get("experiment.product-analysis")).toBe(
      "console-canary|canary|mock=90,openai=10",
    );
    await admin("put", "/admin/settings/experiment.product-analysis")
      .send({ value: null })
      .expect(200);
  });

  it("마지막 남은 Provider는 끌 수 없다 (호출 전멸 방지)", async () => {
    // 사용 가능: mock·openai → mock을 끄면 openai만 남는다
    await admin("put", "/admin/settings/provider.mock.enabled")
      .send({ value: "false" })
      .expect(200);

    // 마지막 하나(openai)까지 끄려 하면 막는다
    const response = await admin(
      "put",
      "/admin/settings/provider.openai.enabled",
    )
      .send({ value: "false" })
      .expect(400);
    expect(response.body.message).toContain("마지막으로 남은 Provider");
    expect(settings.get("provider.openai.enabled")).toBeNull();

    await admin("put", "/admin/settings/provider.mock.enabled")
      .send({ value: null })
      .expect(200);
  });

  it("ADMIN 전용 — EDITOR는 403, 미인증은 401", async () => {
    await request(app.getHttpServer())
      .put("/admin/settings/budget.daily")
      .set("Authorization", "Bearer tok-editor")
      .send({ value: "5" })
      .expect(403);
    await request(app.getHttpServer())
      .put("/admin/settings/budget.daily")
      .send({ value: "5" })
      .expect(401);
  });

  it("조회도 보호된다 — 전역 가드는 쓰기만 막으므로 GET에 별도 인증", async () => {
    // 콘솔 GET은 예산·모델 구성과 감사 이력(수행자 이메일)을 노출한다.
    // 일반 조회 API의 비보호 정책을 그대로 두면 그대로 새어 나간다.
    await request(app.getHttpServer()).get("/admin/console").expect(401);
    await request(app.getHttpServer()).get("/admin/audit").expect(401);
    await request(app.getHttpServer())
      .get("/admin/console")
      .set("Authorization", "Bearer tok-editor")
      .expect(403);
    await request(app.getHttpServer())
      .get("/admin/audit")
      .set("Authorization", "Bearer tok-editor")
      .expect(403);
  });
});
