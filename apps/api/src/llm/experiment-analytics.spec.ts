import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { APP_GUARD } from "@nestjs/core";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { ExperimentAnalyticsService } from "./experiment-analytics.service";
import { ProviderProductionService } from "./provider-production.service";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import { LlmController } from "./llm.controller";
import { LlmBudgetService } from "./llm-budget.service";
import { LlmService } from "./llm.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Experiment Analytics & Recommendation 검증. (TASK-1102, Sprint 11)
 *
 * - 변형별 성과 집계가 Execution을 정확히 합산하는지 (지연은 호출 수 가중 평균)
 * - 승자 추천이 근거·신뢰도와 함께 나오는지
 * - **CTO 결정 1101-④**: Start/Stop은 EDITOR 이상, Promote/Rollback은 ADMIN
 */

const LIFECYCLE_STATE = {
  feature: "product-analysis",
  status: "RUNNING" as const,
  promotedVariant: null,
  actor: null,
  note: null,
  assignmentCount: 0,
  updatedAt: null,
  events: [],
};

function executionRow(
  provider: string,
  model: string,
  status: "SUCCESS" | "FAILED",
  count: number,
  latency: number,
  cost: number | null,
) {
  return {
    provider,
    model,
    status,
    _count: { _all: count },
    _sum: { inputTokens: count * 100, outputTokens: count * 30, cost },
    _avg: { latencyMs: latency },
  };
}

describe("Experiment Analytics API (TASK-1102)", () => {
  let app: INestApplication;
  let groupByRows: ReturnType<typeof executionRow>[] = [];

  beforeAll(async () => {
    process.env.LLM_EXPERIMENT_ANALYSIS =
      "sonnet-canary|ab|openai:gpt-4o=50,anthropic:claude-sonnet-5=50";

    const prisma = {
      execution: { groupBy: async () => groupByRows },
      experimentState: {
        findUnique: async () => ({ id: "state-1", createdAt: new Date(0) }),
      },
      experimentEvent: { findFirst: async () => null },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        {
          provide: LlmService,
          useValue: {
            routing: () => ({
              availableProviders: ["mock", "openai", "anthropic"],
            }),
            experiments: async () => ({
              availableProviders: [],
              experiments: [],
              checkedAt: "",
            }),
          },
        },
        { provide: LlmBudgetService, useValue: { status: async () => ({}) } },
        {
          provide: ExperimentLifecycleService,
          useValue: {
            lifecycle: async () => LIFECYCLE_STATE,
            syncSignature: async () => new Date(0),
            assignments: async () => [],
            distribution: async () => [],
            reassignments: async () => [],
            transition: async () => LIFECYCLE_STATE,
          },
        },
        {
          // 설정 오버라이드 스텁 (TASK-1201) — 콘솔 미사용 = 환경변수 그대로
          provide: AdminSettingsService,
          useValue: { get: () => null, all: () => ({}) },
        },
        ExperimentAnalyticsService,
        {
          // 운영 점검 스텁 (TASK-1301) — 전용 spec에서 검증
          provide: ProviderProductionService,
          useValue: {
            validateProviders: async () => ({ providers: [], blockers: [] }),
            verifyCost: async () => ({ ok: true, issues: [] }),
            monitor: async () => ({ status: "unknown", providers: [], alerts: [] }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateToken: async (token: string) =>
              token === "tok-admin"
                ? { id: "u-a", email: "a@acos.local", role: "ADMIN" }
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
  });

  afterAll(async () => {
    delete process.env.LLM_EXPERIMENT_ANALYSIS;
    await app.close();
  });

  it("변형별 성과를 Execution에서 집계한다 (지연은 호출 수 가중 평균)", async () => {
    groupByRows = [
      // openai:gpt-4o — 90/100 성공, 지연 900·100(가중 평균 820)
      executionRow("openai", "gpt-4o", "SUCCESS", 90, 900, 1.8),
      executionRow("openai", "gpt-4o", "FAILED", 10, 100, null),
      // anthropic:claude-sonnet-5 — 95/100 성공
      executionRow("anthropic", "claude-sonnet-5", "SUCCESS", 95, 500, 0.95),
      executionRow("anthropic", "claude-sonnet-5", "FAILED", 5, 300, null),
      // 실험과 무관한 변형은 제외되어야 한다
      executionRow("mock", "mock-llm-1", "SUCCESS", 1000, 1, 0),
    ];

    const response = await request(app.getHttpServer())
      .get("/llm/experiments/product-analysis/analytics")
      .expect(200);

    expect(response.body.totalCalls).toBe(200); // mock 1000건은 제외
    const [openai, anthropic] = response.body.variants;
    expect(openai).toMatchObject({
      key: "openai:gpt-4o",
      calls: 100,
      successes: 90,
      successRate: 0.9,
    });
    // (900*90 + 100*10) / 100 = 820
    expect(openai.avgLatencyMs).toBeCloseTo(820, 6);
    expect(openai.costPerCall).toBeCloseTo(0.018, 6);
    expect(anthropic).toMatchObject({
      key: "anthropic:claude-sonnet-5",
      calls: 100,
      successRate: 0.95,
    });
    // 신뢰구간이 함께 온다 (표본 과신 방지)
    expect(openai.successRateLow).toBeLessThan(0.9);
    expect(openai.successRateHigh).toBeGreaterThan(0.9);
  });

  it("성공률·지연·비용 비교를 기준 변형 대비로 제공한다", async () => {
    groupByRows = [
      executionRow("openai", "gpt-4o", "SUCCESS", 90, 900, 1.8),
      executionRow("openai", "gpt-4o", "FAILED", 10, 900, null),
      executionRow("anthropic", "claude-sonnet-5", "SUCCESS", 95, 500, 0.95),
      executionRow("anthropic", "claude-sonnet-5", "FAILED", 5, 500, null),
    ];

    const response = await request(app.getHttpServer())
      .get("/llm/experiments/product-analysis/analytics")
      .expect(200);

    expect(response.body.baseline).toBe("openai:gpt-4o");
    const [comparison] = response.body.comparisons;
    expect(comparison.key).toBe("anthropic:claude-sonnet-5");
    expect(comparison.successRateDelta).toBeCloseTo(0.05, 6);
    expect(comparison.latencyDelta).toBeCloseTo(-400, 6);
    expect(comparison.costPerCallDelta).toBeCloseTo(-0.0085, 6);
    expect(comparison.successRateConfidence).toBeGreaterThan(0);
  });

  it("승자 추천이 근거·신뢰도와 함께 나온다", async () => {
    groupByRows = [
      executionRow("openai", "gpt-4o", "SUCCESS", 400, 500, 4),
      executionRow("openai", "gpt-4o", "FAILED", 100, 500, null),
      executionRow("anthropic", "claude-sonnet-5", "SUCCESS", 495, 500, 5),
      executionRow("anthropic", "claude-sonnet-5", "FAILED", 5, 500, null),
    ];

    const response = await request(app.getHttpServer())
      .get("/llm/experiments/product-analysis/analytics")
      .expect(200);

    expect(response.body.recommendation).toMatchObject({
      winner: "anthropic:claude-sonnet-5",
      basis: "success-rate",
      conclusive: true,
    });
    expect(response.body.recommendation.confidence).toBeGreaterThan(0.95);
    expect(response.body.recommendation.reason).toContain("성공률");
  });

  it("표본이 부족하면 추천하지 않는다", async () => {
    groupByRows = [
      executionRow("openai", "gpt-4o", "SUCCESS", 5, 500, 0.1),
      executionRow("anthropic", "claude-sonnet-5", "SUCCESS", 3, 500, 0.1),
    ];

    const response = await request(app.getHttpServer())
      .get("/llm/experiments/product-analysis/analytics")
      .expect(200);

    expect(response.body.recommendation).toMatchObject({
      winner: null,
      basis: "insufficient-data",
      conclusive: false,
    });
  });

  it("실험 대상이 아닌 feature는 400", async () => {
    await request(app.getHttpServer())
      .get("/llm/experiments/unknown-feature/analytics")
      .expect(400);
  });

  describe("전이 권한 (CTO 결정 1101-④)", () => {
    it("Start/Stop — EDITOR 이상이면 허용", async () => {
      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/stop")
        .set("Authorization", "Bearer tok-editor")
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/start")
        .set("Authorization", "Bearer tok-editor")
        .send({})
        .expect(200);
    });

    it("Promote/Rollback — EDITOR는 403, ADMIN만 허용", async () => {
      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/promote")
        .set("Authorization", "Bearer tok-editor")
        .send({ variantKey: "openai:gpt-4o" })
        .expect(403);
      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/rollback")
        .set("Authorization", "Bearer tok-editor")
        .send({})
        .expect(403);

      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/promote")
        .set("Authorization", "Bearer tok-admin")
        .send({ variantKey: "openai:gpt-4o" })
        .expect(200);
      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/rollback")
        .set("Authorization", "Bearer tok-admin")
        .send({})
        .expect(200);
    });

    it("미인증은 401", async () => {
      await request(app.getHttpServer())
        .post("/llm/experiments/product-analysis/stop")
        .send({})
        .expect(401);
    });
  });
});
