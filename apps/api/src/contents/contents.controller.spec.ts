import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockContentGenerator } from "@acos/core";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";

describe("Contents API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = createPrismaMock();

  beforeAll(async () => {
    prismaMock.productObjects.push({ ...readyProductObject });

    const moduleRef = await Test.createTestingModule({
      controllers: [ContentsController],
      providers: [
        ContentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CONTENT_GENERATOR, useValue: new MockContentGenerator() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/contents — 상세페이지를 생성한다", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/contents")
      .send({})
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      productObjectVersion: 2,
      status: "DRAFT",
    });
    expect(response.body.body).toContain("# Magic Clean PVC Mat");
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
});
