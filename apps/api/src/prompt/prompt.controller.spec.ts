import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDefaultPromptEngine } from "@acos/core";
import request from "supertest";
import { PROMPT_ENGINE } from "./prompt.constants";
import { PromptController } from "./prompt.controller";

describe("Prompt API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PromptController],
      providers: [
        { provide: PROMPT_ENGINE, useValue: createDefaultPromptEngine() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /prompt/templates — 등록된 템플릿 목록 (content-generation 포함)", async () => {
    const response = await request(app.getHttpServer())
      .get("/prompt/templates")
      .expect(200);

    expect(response.body.templates).toHaveLength(1);
    expect(response.body.templates[0]).toMatchObject({
      key: "content-generation",
      name: "상세페이지 생성",
    });
  });
});
