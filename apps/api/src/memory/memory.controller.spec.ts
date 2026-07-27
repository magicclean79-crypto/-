import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { MemoryController } from "./memory.controller";
import { MemoryService } from "./memory.service";
import { PrismaMemoryStore } from "./prisma-memory.store";
import { createStoreMock, validRequest } from "./memory.spec-helpers";

describe("Memory API — Structured Memory (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        MemoryService,
        { provide: PrismaMemoryStore, useValue: createStoreMock() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /memory — 저장 201, 중복 key 400, 검증 400", async () => {
    const response = await request(app.getHttpServer())
      .post("/memory")
      .send(validRequest)
      .expect(201);

    expect(response.body).toMatchObject({
      scope: "PROJECT",
      scopeId: "proj-1",
      key: "preferred-tone",
      value: { tone: "친근함", emoji: false },
    });

    await request(app.getHttpServer())
      .post("/memory")
      .send(validRequest)
      .expect(400); // 중복 (scope, scopeId, key)

    await request(app.getHttpServer())
      .post("/memory")
      .send({ scope: "", key: "k", value: 1 })
      .expect(400);
  });

  it("GET /memory — scope/scopeId 필터 목록 · GET /:memoryId — 단건/404", async () => {
    await request(app.getHttpServer())
      .post("/memory")
      .send({ scope: "GLOBAL", key: "banned-words", value: ["최고", "1위"] });

    const all = await request(app.getHttpServer()).get("/memory").expect(200);
    expect(all.body.memories.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app.getHttpServer())
      .get("/memory?scope=GLOBAL")
      .expect(200);
    expect(
      filtered.body.memories.every(
        (memory: { scope: string }) => memory.scope === "GLOBAL",
      ),
    ).toBe(true);

    const id = filtered.body.memories[0].id;
    const single = await request(app.getHttpServer())
      .get(`/memory/${id}`)
      .expect(200);
    expect(single.body.id).toBe(id);

    await request(app.getHttpServer()).get("/memory/nope").expect(404);
  });

  it("PATCH — value/description 수정 200, 빈 수정 400 · DELETE — 204 후 404", async () => {
    const created = await request(app.getHttpServer())
      .post("/memory")
      .send({ scope: "GLOBAL", key: "patch-target", value: 1 });
    const id = created.body.id;

    const patched = await request(app.getHttpServer())
      .patch(`/memory/${id}`)
      .send({ value: { nested: true } })
      .expect(200);
    expect(patched.body.value).toEqual({ nested: true });

    await request(app.getHttpServer()).patch(`/memory/${id}`).send({}).expect(400);

    await request(app.getHttpServer()).delete(`/memory/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/memory/${id}`).expect(404);
  });
});
