import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { CompanyBrainController } from "./company-brain.controller";
import { CompanyBrainService } from "./company-brain.service";
import { createPrismaMock } from "./company-brain.spec-helpers";

describe("Company Brain API (API Test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyBrainController],
      providers: [
        CompanyBrainService,
        { provide: PrismaService, useValue: createPrismaMock() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /company-brain/query — 200, 고정 순서 4개 섹션", async () => {
    const response = await request(app.getHttpServer())
      .post("/company-brain/query")
      .send({ query: "금지어" })
      .expect(200);

    expect(response.body.query).toBe("금지어");
    expect(
      response.body.results.map(
        (section: { source: string }) => section.source,
      ),
    ).toEqual(["MEMORY", "KNOWLEDGE", "DECISION", "SOP"]);
  });

  it("POST /company-brain/query — 빈 query/잘못된 scope는 400", async () => {
    await request(app.getHttpServer())
      .post("/company-brain/query")
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post("/company-brain/query")
      .send({ query: "q", scope: "TEAM" })
      .expect(400);
  });
});
