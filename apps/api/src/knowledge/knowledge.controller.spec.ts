import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { PrismaKnowledgeRepository } from "./prisma-knowledge.repository";
import {
  createRepositoryMock,
  validRequest,
} from "./knowledge.spec-helpers";

describe("Knowledge API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        KnowledgeService,
        { provide: PrismaKnowledgeRepository, useValue: createRepositoryMock() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /knowledge — 생성 201, 검증 실패 400", async () => {
    const response = await request(app.getHttpServer())
      .post("/knowledge")
      .send(validRequest)
      .expect(201);

    expect(response.body).toMatchObject({
      title: validRequest.title,
      category: "금지어",
    });

    await request(app.getHttpServer())
      .post("/knowledge")
      .send({ ...validRequest, content: "" })
      .expect(400);
  });

  it("GET /knowledge — 목록 · GET /:knowledgeId — 단건/404", async () => {
    const list = await request(app.getHttpServer())
      .get("/knowledge")
      .expect(200);
    expect(list.body.knowledge.length).toBeGreaterThanOrEqual(1);

    const id = list.body.knowledge[0].id;
    const single = await request(app.getHttpServer())
      .get(`/knowledge/${id}`)
      .expect(200);
    expect(single.body.id).toBe(id);

    await request(app.getHttpServer()).get("/knowledge/nope").expect(404);
  });

  it("PATCH — 부분 수정 200 · DELETE — 204 후 404", async () => {
    const created = await request(app.getHttpServer())
      .post("/knowledge")
      .send({ ...validRequest, title: "수정 대상 지식" });
    const id = created.body.id;

    const patched = await request(app.getHttpServer())
      .patch(`/knowledge/${id}`)
      .send({ content: "개정된 내용" })
      .expect(200);
    expect(patched.body.content).toBe("개정된 내용");
    expect(patched.body.title).toBe("수정 대상 지식");

    await request(app.getHttpServer()).delete(`/knowledge/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/knowledge/${id}`).expect(404);
  });
});
