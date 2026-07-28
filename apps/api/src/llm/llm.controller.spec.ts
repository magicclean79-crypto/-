import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockLlmProvider } from "@acos/core";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { HealthProtectionGuard } from "../auth/health-protection.guard";
import { ExperimentAnalyticsService } from "./experiment-analytics.service";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import { LlmBudgetService } from "./llm-budget.service";
import { LLM_PROVIDER } from "./llm.constants";
import { LlmController } from "./llm.controller";
import { LlmService } from "./llm.service";

describe("LLM API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        LlmService,
        { provide: LLM_PROVIDER, useValue: new MockLlmProvider() },
        {
          // 예산 로직 자체는 llm-budget.service.spec에서 검증
          provide: LlmBudgetService,
          useValue: {
            status: async () => ({
              daily: { budget: null, spend: 0, ratio: null, status: "off" },
              monthly: { budget: null, spend: 0, ratio: null, status: "off" },
              alertRatio: 0.8,
              checkedAt: new Date().toISOString(),
            }),
            assertWithinBudget: async () => undefined,
          },
        },
        {
          // 실험 상태·배정 스텁 (TASK-1101) — DB 동작은 전용 spec에서 검증
          provide: ExperimentLifecycleService,
          useValue: {
            lifecycle: async (feature: string) => ({
              feature,
              status: "RUNNING",
              promotedVariant: null,
              actor: null,
              note: null,
              assignmentCount: 0,
              updatedAt: null,
              events: [],
            }),
            state: async () => ({ status: "RUNNING", promotedVariant: null }),
            assignments: async () => [],
            distribution: async () => [],
            reassignments: async () => [],
            transition: async () => ({
              feature: "product-analysis",
              status: "STOPPED",
              promotedVariant: null,
              actor: null,
              note: null,
              assignmentCount: 0,
              updatedAt: new Date().toISOString(),
              events: [],
            }),
          },
        },
        {
          // 분석 스텁 (TASK-1102) — 계산 로직은 core/전용 spec에서 검증
          provide: ExperimentAnalyticsService,
          useValue: {
            analyze: async (feature: string) => ({
              feature,
              name: feature,
              configured: false,
              status: "RUNNING",
              promotedVariant: null,
              since: null,
              totalCalls: 0,
              baseline: null,
              variants: [],
              comparisons: [],
              recommendation: {
                winner: null,
                basis: "no-variants",
                confidence: 0,
                reason: "비교할 변형이 없습니다.",
                conclusive: false,
              },
              checkedAt: new Date().toISOString(),
            }),
          },
        },
        HealthProtectionGuard,
        {
          // 가드 검증용 스텁 — 실제 세션 조회는 auth.controller.spec에서 검증
          provide: AuthService,
          useValue: {
            validateToken: async (token: string) =>
              token === "tok-editor"
                ? { id: "u-e", email: "e@acos.local", role: "EDITOR" }
                : token === "tok-viewer"
                  ? { id: "u-v", email: "v@acos.local", role: "VIEWER" }
                  : null,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AUTH_PROTECT_HEALTH;
  });

  it("GET /llm — 선택된 Provider 확인 (기본 mock)", async () => {
    const response = await request(app.getHttpServer()).get("/llm").expect(200);
    expect(response.body).toEqual({
      provider: "mock",
      defaultModel: "mock-llm-1",
    });
  });

  it("POST /llm/complete — 200, mock 완성 응답", async () => {
    const response = await request(app.getHttpServer())
      .post("/llm/complete")
      .send({
        messages: [{ role: "user", content: "상세페이지 도입부를 써줘" }],
      })
      .expect(200);

    expect(response.body.provider).toBe("mock");
    expect(response.body.text).toContain("상세페이지 도입부");
  });

  it("POST /llm/complete — 검증 실패 400", async () => {
    await request(app.getHttpServer())
      .post("/llm/complete")
      .send({ messages: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post("/llm/complete")
      .send({})
      .expect(400);
  });

  it("GET /llm/providers — Registry·라우팅·선택 상태 (TASK-0902, 키 값 비노출)", async () => {
    const response = await request(app.getHttpServer())
      .get("/llm/providers")
      .expect(200);

    expect(response.body.selected).toEqual({
      provider: "mock",
      defaultModel: "mock-llm-1",
    });
    expect(response.body.routing).toEqual({
      "content-generation": null,
      "product-analysis": null,
      "vision-analysis": null,
    });
    const names = response.body.providers.map(
      (item: { name: string }) => item.name,
    );
    expect(names).toEqual(["mock", "openai", "anthropic", "gemini"]);
    const openai = response.body.providers.find(
      (item: { name: string }) => item.name === "openai",
    );
    expect(openai).toMatchObject({
      connection: "official",
      selected: false,
      defaultModel: "gpt-4o",
    });
    expect(JSON.stringify(response.body)).not.toContain("sk-"); // 키 값 비노출
    const mock = response.body.providers.find(
      (item: { name: string }) => item.name === "mock",
    );
    expect(mock.selected).toBe(true);
  });

  it("GET /llm/budget — 예산 현황 (미설정 시 off)", async () => {
    const response = await request(app.getHttpServer())
      .get("/llm/budget")
      .expect(200);
    expect(response.body.daily.status).toBe("off");
    expect(response.body.monthly.status).toBe("off");
    expect(response.body.alertRatio).toBe(0.8);
  });

  it("GET /llm/health — 개발 환경(기본)은 비보호 (TASK-0803)", async () => {
    delete process.env.AUTH_PROTECT_HEALTH;
    await request(app.getHttpServer()).get("/llm/health").expect(200);
  });

  it("GET /llm/health — 운영/스테이징(AUTH_PROTECT_HEALTH=1)은 EDITOR 이상 (CTO 결정 0802-③)", async () => {
    process.env.AUTH_PROTECT_HEALTH = "1";
    await request(app.getHttpServer()).get("/llm/health").expect(401);
    await request(app.getHttpServer())
      .get("/llm/health")
      .set("Authorization", "Bearer tok-viewer")
      .expect(403);
    const response = await request(app.getHttpServer())
      .get("/llm/health")
      .set("Authorization", "Bearer tok-editor")
      .expect(200);
    expect(response.body.provider).toBe("mock");
    delete process.env.AUTH_PROTECT_HEALTH;
  });
});
