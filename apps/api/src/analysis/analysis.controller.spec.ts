import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createDefaultPromptEngine,
  LlmAnalysisProvider,
  MockLlmProvider,
} from "@acos/core";
import request from "supertest";
import type { AnalysisResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { ANALYSIS_PROVIDER } from "./analysis.constants";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { PrismaAnalysisRunStore } from "./prisma-analysis-run.store";

describe("Analysis API (API Test)", () => {
  let app: INestApplication;
  const rows = new Map<string, AnalysisResult>();
  let sequence = 0;

  const prismaMock = {
    product: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "prod-1"
          ? {
              id: "prod-1",
              projectId: "proj-1",
              name: "테스트 상품",
              description: null,
              images: [
                {
                  id: "img-1",
                  key: "images/a.png",
                  mimeType: "image/png",
                  ocrResults: [{ extractedText: "Magic Clean PVC Mat" }],
                },
              ],
            }
          : null,
      ),
      update: jest.fn(async () => ({})),
    },
    analysisResult: {
      create: jest.fn(async ({ data }: { data: Partial<AnalysisResult> }) => {
        const now = new Date();
        const row = {
          id: `an-${++sequence}`,
          result: null,
          rawJson: null,
          error: null,
          attempts: 0,
          applied: false,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as AnalysisResult;
        rows.set(row.id, row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<AnalysisResult>;
        }) => {
          const row = rows.get(where.id) as AnalysisResult;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => ({
          ...(rows.get(where.id) as AnalysisResult),
        }),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { productId: string } }) => {
          const matches = [...rows.values()]
            .filter((row) => row.productId === where.productId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return matches[0] ? { ...matches[0] } : null;
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where?: { productId?: string } }) =>
          [...rows.values()].filter(
            (row) => !where?.productId || row.productId === where.productId,
          ),
      ),
    },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnalysisController],
      providers: [
        AnalysisService,
        PrismaAnalysisRunStore,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: StorageService,
          useValue: { getObject: jest.fn(async () => Buffer.from("img")) },
        },
        {
          // 공식 엔진(LLM 기반)을 mock LLM으로 구성 — 운영 기본 구성과 동일한 경로
          provide: ANALYSIS_PROVIDER,
          useValue: (() => {
            const llm = new MockLlmProvider();
            return new LlmAnalysisProvider({
              promptEngine: createDefaultPromptEngine(),
              llmProviderName: llm.name,
              complete: async (req) => {
                const result = await llm.complete(req);
                return {
                  provider: result.provider,
                  model: result.model,
                  text: result.text,
                };
              },
              loadCompanyBrain: async () => ({
                knowledge: [],
                decisions: [],
                memories: [],
              }),
            });
          })(),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /products/:id/analysis — LLM 기반 구조화 결과를 반환한다", async () => {
    const response = await request(app.getHttpServer())
      .post("/products/prod-1/analysis")
      .send({})
      .expect(201);

    expect(response.body).toMatchObject({
      productId: "prod-1",
      provider: "llm:mock",
      status: "SUCCESS",
      applied: false,
    });
    expect(response.body.result).toMatchObject({
      name: "Magic Clean PVC Mat",
      category: "미분류",
      confidence: 0.3,
    });
    expect(Array.isArray(response.body.result.keywords)).toBe(true);
  });

  it("GET /products/:id/analysis — 최신 결과 (rawJson 제외)", async () => {
    const response = await request(app.getHttpServer())
      .get("/products/prod-1/analysis")
      .expect(200);

    expect(response.body.status).toBe("SUCCESS");
    expect(response.body.rawJson).toBeUndefined();
  });

  it("GET /products/:id/analysis/history — 실행 이력", async () => {
    await request(app.getHttpServer())
      .post("/products/prod-1/analysis")
      .send({})
      .expect(201);

    const response = await request(app.getHttpServer())
      .get("/products/prod-1/analysis/history")
      .expect(200);

    expect(response.body.results.length).toBeGreaterThanOrEqual(2);
  });

  it("POST — 없는 상품은 404", async () => {
    await request(app.getHttpServer())
      .post("/products/nope/analysis")
      .send({})
      .expect(404);
  });
});
