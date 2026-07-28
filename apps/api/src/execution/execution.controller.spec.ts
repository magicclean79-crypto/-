import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { Execution } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ExecutionController } from "./execution.controller";
import { ExecutionService } from "./execution.service";

const rows: Execution[] = [
  {
    id: "exec-2",
    feature: "product-analysis",
    provider: "llm:mock",
    model: "mock-llm-1",
    status: "SUCCESS",
    inputTokens: 300,
    outputTokens: 80,
    cost: "0" as unknown as Execution["cost"],
    latencyMs: 12,
    error: null,
    createdAt: new Date("2026-07-28T02:00:00Z"),
  },
  {
    id: "exec-1",
    feature: "content-generation",
    provider: "mock",
    model: "mock-llm-1",
    status: "FAILED",
    inputTokens: null,
    outputTokens: null,
    cost: null,
    latencyMs: 40,
    error: "모델 오류",
    createdAt: new Date("2026-07-28T01:00:00Z"),
  },
];

describe("Execution API (API Test)", () => {
  let app: INestApplication;
  const prismaMock = {
    execution: {
      findMany: jest.fn(
        async ({ where, take }: { where?: { feature?: string }; take: number }) =>
          rows
            .filter((row) => !where?.feature || row.feature === where.feature)
            .slice(0, take),
      ),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [
        ExecutionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /executions — 최신순 이력 (cost는 숫자/null로 직렬화)", async () => {
    const response = await request(app.getHttpServer())
      .get("/executions")
      .expect(200);

    expect(response.body.executions).toHaveLength(2);
    expect(response.body.executions[0]).toMatchObject({
      id: "exec-2",
      feature: "product-analysis",
      status: "SUCCESS",
      cost: 0,
      latencyMs: 12,
    });
    expect(response.body.executions[1]).toMatchObject({
      id: "exec-1",
      status: "FAILED",
      cost: null,
      error: "모델 오류",
    });
  });

  it("GET /executions?feature= — 기능별 필터", async () => {
    const response = await request(app.getHttpServer())
      .get("/executions?feature=content-generation")
      .expect(200);

    expect(response.body.executions).toHaveLength(1);
    expect(response.body.executions[0].feature).toBe("content-generation");
  });

  it("GET /executions?limit= — 잘못된 limit은 400", async () => {
    await request(app.getHttpServer()).get("/executions?limit=0").expect(400);
    await request(app.getHttpServer()).get("/executions?limit=abc").expect(400);
  });
});
