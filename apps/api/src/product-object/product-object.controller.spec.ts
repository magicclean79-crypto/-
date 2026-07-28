import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createDefaultPromptEngine,
  LlmVisionProvider,
  MockLlmProvider,
} from "@acos/core";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { ProductObjectController } from "./product-object.controller";
import { ProductObjectService } from "./product-object.service";
import {
  createPrismaMock,
  projectWithOcr,
} from "./product-object.spec-helpers";
import { VISION_PROVIDER } from "./vision.constants";

describe("Product Object API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = createPrismaMock();

  beforeAll(async () => {
    prismaMock.project.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1" ? projectWithOcr : null,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductObjectController],
      providers: [
        ProductObjectService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: StorageService,
          useValue: { getObject: jest.fn(async () => Buffer.from("img")) },
        },
        {
          // 공식 Vision 엔진(LLM 기반)을 mock LLM으로 구성
          provide: VISION_PROVIDER,
          useValue: (() => {
            const llm = new MockLlmProvider();
            return new LlmVisionProvider({
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

  it("POST /projects/:id/product-object — Builder 결과를 저장하고 반환한다", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/product-object")
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      version: 1,
      status: "DRAFT",
      // mock LLM 초안 기준 vision.suggestedTitle = OCR 첫 줄
      title: "Magic Clean PVC Mat",
      category: "미분류",
    });
    expect(response.body.ocrSummary.combinedText).toContain(
      "Magic Clean PVC Mat",
    );
    expect(response.body.visionSummary.source).toBe("llm:mock");
    expect(response.body.metadata.builderVersion).toBe("1.0.0");
  });

  it("GET /projects/:id/product-object — 최신 버전을 반환한다", async () => {
    await request(app.getHttpServer())
      .post("/projects/proj-1/product-object")
      .expect(201);

    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/product-object")
      .expect(200);

    expect(response.body.version).toBe(2);
  });

  it("GET ?version=1 — 특정 버전, 잘못된 version은 400", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/product-object?version=1")
      .expect(200);
    expect(response.body.version).toBe(1);

    await request(app.getHttpServer())
      .get("/projects/proj-1/product-object?version=abc")
      .expect(400);
  });

  it("GET /history — 버전 이력 (최신순)", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/product-object/history")
      .expect(200);

    expect(response.body.results.length).toBeGreaterThanOrEqual(2);
    expect(response.body.results[0].version).toBeGreaterThan(
      response.body.results[1].version,
    );
  });

  it("POST — 없는 프로젝트는 404", async () => {
    await request(app.getHttpServer())
      .post("/projects/nope/product-object")
      .expect(404);
  });

  it("PATCH /:version/status — DRAFT→READY 전환, 잘못된 전이는 400", async () => {
    const ready = await request(app.getHttpServer())
      .patch("/projects/proj-1/product-object/1/status")
      .send({ status: "READY" })
      .expect(200);
    expect(ready.body.status).toBe("READY");

    await request(app.getHttpServer())
      .patch("/projects/proj-1/product-object/1/status")
      .send({ status: "READY" }) // READY → READY 불가
      .expect(400);

    await request(app.getHttpServer())
      .patch("/projects/proj-1/product-object/1/status")
      .send({}) // status 누락
      .expect(400);
  });
});
