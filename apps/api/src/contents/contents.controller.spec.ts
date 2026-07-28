import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { ContentGenerationService } from "./content-generation.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";
import { EngineContentGenerator } from "./engine-content.generator";

describe("Contents API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = createPrismaMock();
  // TASK-0506: 구 경로가 공식 엔진(generateMarkdown)을 호출하는지 검증하는 목업
  const engineMock = {
    generate: jest.fn(),
    generateMarkdown: jest.fn(async () => ({
      title: "엔진 생성 상세페이지",
      body: "# 엔진 생성 상세페이지\n\n공식 엔진 본문",
      llm: { provider: "mock", model: "mock-llm-1" },
    })),
  };

  beforeAll(async () => {
    prismaMock.productObjects.push({ ...readyProductObject });

    const moduleRef = await Test.createTestingModule({
      controllers: [ContentsController],
      providers: [
        ContentsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: CONTENT_GENERATOR,
          useValue: new EngineContentGenerator(
            engineMock as unknown as ContentGenerationService,
          ),
        },
        {
          provide: ContentGenerationService,
          useValue: engineMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/contents — 구 계약 유지, 내부는 공식 엔진 호출 (TASK-0506)", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/contents")
      .send({})
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      productObjectVersion: 2,
      status: "DRAFT",
      title: "엔진 생성 상세페이지",
    });
    expect(response.body.body).toContain("# 엔진 생성 상세페이지");
    expect(engineMock.generateMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ id: "proj-1" }),
        productObject: expect.objectContaining({
          title: "Magic Clean PVC Mat",
          version: 2,
          ocrText: "Magic Clean PVC Mat",
        }),
      }),
    );
  });

  it("GET /projects/:id/contents — 목록", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/contents")
      .expect(200);

    expect(response.body.contents.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /projects/:id/contents/:contentId — 단건/404", async () => {
    const list = await request(app.getHttpServer()).get(
      "/projects/proj-1/contents",
    );
    const id = list.body.contents[0].id;

    const response = await request(app.getHttpServer())
      .get(`/projects/proj-1/contents/${id}`)
      .expect(200);
    expect(response.body.id).toBe(id);

    await request(app.getHttpServer())
      .get("/projects/proj-1/contents/nope")
      .expect(404);
  });

  it("POST — 없는 프로젝트 404", async () => {
    await request(app.getHttpServer())
      .post("/projects/nope/contents")
      .send({})
      .expect(404);
  });

  it("POST /projects/:id/contents/generate — Content Generation Engine으로 라우팅 (TASK-0502)", async () => {
    const engine = app.get(ContentGenerationService) as unknown as {
      generate: jest.Mock;
    };
    engine.generate.mockResolvedValue({
      id: "content-gen-1",
      projectId: "proj-1",
      productObjectId: "po-1",
      productObjectVersion: 2,
      title: "생성된 상세페이지",
      body: "# 생성된 상세페이지",
      status: "DRAFT",
      createdAt: "",
      updatedAt: "",
    });

    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/contents/generate")
      .send({ productObjectVersion: 2 })
      .expect(201);

    expect(response.body.title).toBe("생성된 상세페이지");
    expect(engine.generate).toHaveBeenCalledWith("proj-1", {
      productObjectVersion: 2,
    });
  });
});
