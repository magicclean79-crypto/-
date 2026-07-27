import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockLlmProvider } from "@acos/core";
import request from "supertest";
import { LLM_PROVIDER } from "./llm.constants";
import { LlmController } from "./llm.controller";
import { LlmService } from "./llm.service";

describe("LLM API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        LlmService,
        { provide: LLM_PROVIDER, useValue: new MockLlmProvider() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /llm — 선택된 Provider 확인 (기본 mock)", async () => {
    const response = await request(app.getHttpServer()).get("/llm").expect(200);
    expect(response.body).toEqual({
      provider: "mock",
      defaultModel: "mock-llm-1",
    });
  });

  it("POST /llm/complete — 200, mock 완성 응답", async () => {
    const response = await request(app.getHttpServer())
      .post("/llm/complete")
      .send({
        messages: [{ role: "user", content: "상세페이지 도입부를 써줘" }],
      })
      .expect(200);

    expect(response.body.provider).toBe("mock");
    expect(response.body.text).toContain("상세페이지 도입부");
  });

  it("POST /llm/complete — 검증 실패 400", async () => {
    await request(app.getHttpServer())
      .post("/llm/complete")
      .send({ messages: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post("/llm/complete")
      .send({})
      .expect(400);
  });
});
