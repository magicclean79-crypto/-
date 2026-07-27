import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { ProductObjectController } from "./product-object.controller";
import { ProductObjectService } from "./product-object.service";
import {
  createPrismaMock,
  projectWithOcr,
} from "./product-object.spec-helpers";

describe("Product Object API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = createPrismaMock();

  beforeAll(async () => {
    prismaMock.product.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === "proj-1" ? projectWithOcr : null,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductObjectController],
      providers: [
        ProductObjectService,
        { provide: PrismaService, useValue: prismaMock },
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
      title: "매직클린 걸레",
      category: "생활용품",
    });
    expect(response.body.ocrSummary.combinedText).toContain(
      "Magic Clean PVC Mat",
    );
    expect(response.body.visionSummary.source).toBe("mock");
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
});
