import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectMemoriesController } from "./project-memories.controller";
import { ProjectMemoriesService } from "./project-memories.service";
import { PrismaProjectMemoryStore } from "./prisma-project-memory.store";
import {
  createPrismaMock,
  createStoreMock,
  validRequest,
} from "./project-memories.spec-helpers";

describe("ProjectMemories API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectMemoriesController],
      providers: [
        ProjectMemoriesService,
        { provide: PrismaService, useValue: createPrismaMock() },
        { provide: PrismaProjectMemoryStore, useValue: createStoreMock() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /projects/:id/memories — 기록 201, 검증 400, 없는 프로젝트 404", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/proj-1/memories")
      .send(validRequest)
      .expect(201);

    expect(response.body).toMatchObject({
      projectId: "proj-1",
      title: validRequest.title,
      source: "TASK-0303",
    });

    await request(app.getHttpServer())
      .post("/projects/proj-1/memories")
      .send({ ...validRequest, content: "" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/projects/nope/memories")
      .send(validRequest)
      .expect(404);
  });

  it("GET /projects/:id/memories — 목록 · GET :memoryId — 단건/404", async () => {
    const list = await request(app.getHttpServer())
      .get("/projects/proj-1/memories")
      .expect(200);
    expect(list.body.memories.length).toBeGreaterThanOrEqual(1);

    const id = list.body.memories[0].id;
    const single = await request(app.getHttpServer())
      .get(`/projects/proj-1/memories/${id}`)
      .expect(200);
    expect(single.body.id).toBe(id);

    await request(app.getHttpServer())
      .get("/projects/proj-1/memories/nope")
      .expect(404);
  });

  it("PATCH — 부분 수정 200 · DELETE — 204 후 404", async () => {
    const created = await request(app.getHttpServer())
      .post("/projects/proj-1/memories")
      .send({ ...validRequest, title: "수정 대상 기억" });
    const id = created.body.id;

    const patched = await request(app.getHttpServer())
      .patch(`/projects/proj-1/memories/${id}`)
      .send({ content: "고쳐 쓴 내용" })
      .expect(200);
    expect(patched.body.content).toBe("고쳐 쓴 내용");
    expect(patched.body.title).toBe("수정 대상 기억");

    await request(app.getHttpServer())
      .delete(`/projects/proj-1/memories/${id}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/projects/proj-1/memories/${id}`)
      .expect(404);
  });
});
