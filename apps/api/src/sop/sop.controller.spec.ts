import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ContentsService } from "../contents/contents.service";
import { OcrService } from "../ocr/ocr.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProductObjectService } from "../product-object/product-object.service";
import { SopController } from "./sop.controller";
import { SopService } from "./sop.service";
import { createPrismaMock, createServiceMocks } from "./sop.spec-helpers";

describe("SOP API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = createPrismaMock();
  const mocks = createServiceMocks();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SopController],
      providers: [
        SopService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OcrService, useValue: mocks.ocr },
        { provide: ProductObjectService, useValue: mocks.productObject },
        { provide: ContentsService, useValue: mocks.contents },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/sop-runs — 기본 SOP를 실행하고 이력을 반환한다", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/sop-runs")
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      sopKey: "product-content",
      status: "DONE",
    });
    expect(response.body.steps).toHaveLength(4);
    expect(
      response.body.steps.map((step: { key: string }) => step.key),
    ).toEqual(["ocr", "assemble", "ready", "content"]);
  });

  it("GET /projects/:id/sop-runs — 이력 목록", async () => {
    const response = await request(app.getHttpServer())
      .get("/projects/proj-1/sop-runs")
      .expect(200);

    expect(response.body.sopRuns.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /projects/:id/sop-runs/:runId — 단건/404", async () => {
    const list = await request(app.getHttpServer()).get(
      "/projects/proj-1/sop-runs",
    );
    const id = list.body.sopRuns[0].id;

    const response = await request(app.getHttpServer())
      .get(`/projects/proj-1/sop-runs/${id}`)
      .expect(200);
    expect(response.body.id).toBe(id);

    await request(app.getHttpServer())
      .get("/projects/proj-1/sop-runs/nope")
      .expect(404);
  });

  it("POST — 없는 프로젝트 404", async () => {
    await request(app.getHttpServer())
      .post("/projects/nope/sop-runs")
      .expect(404);
  });
});
