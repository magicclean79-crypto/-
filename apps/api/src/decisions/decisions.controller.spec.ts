import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { DecisionsController } from "./decisions.controller";
import { DecisionsService } from "./decisions.service";
import { PrismaDecisionRepository } from "./prisma-decision.repository";
import {
  createPrismaMock,
  createRepositoryMock,
  validRequest,
} from "./decisions.spec-helpers";

describe("Decisions API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DecisionsController],
      providers: [
        DecisionsService,
        { provide: PrismaService, useValue: createPrismaMock() },
        { provide: PrismaDecisionRepository, useValue: createRepositoryMock() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/decisions — 생성 201, 검증 실패 400, 없는 프로젝트 404", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/decisions")
      .send(validRequest)
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      title: validRequest.title,
      decisionType: "architecture",
      author: "CTO",
    });

    await request(app.getHttpServer())
      .post("/projects/proj-1/decisions")
      .send({ ...validRequest, author: "" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/projects/nope/decisions")
      .send(validRequest)
      .expect(404);
  });

  it("GET /projects/:id/decisions — 목록 · GET :decisionId — 단건/404", async () => {
    const list = await request(app.getHttpServer())
      .get("/projects/proj-1/decisions")
      .expect(200);
    expect(list.body.decisions.length).toBeGreaterThanOrEqual(1);

    const id = list.body.decisions[0].id;
    const single = await request(app.getHttpServer())
      .get(`/projects/proj-1/decisions/${id}`)
      .expect(200);
    expect(single.body.id).toBe(id);

    await request(app.getHttpServer())
      .get("/projects/proj-1/decisions/nope")
      .expect(404);
  });

  it("PATCH — 부분 수정 200 · DELETE — 204 후 404", async () => {
    const created = await request(app.getHttpServer())
      .post("/projects/proj-1/decisions")
      .send({ ...validRequest, title: "수정 대상" });
    const id = created.body.id;

    const patched = await request(app.getHttpServer())
      .patch(`/projects/proj-1/decisions/${id}`)
      .send({ reason: "근거 보강" })
      .expect(200);
    expect(patched.body.reason).toBe("근거 보강");
    expect(patched.body.title).toBe("수정 대상");

    await request(app.getHttpServer())
      .delete(`/projects/proj-1/decisions/${id}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/projects/proj-1/decisions/${id}`)
      .expect(404);
  });
});
