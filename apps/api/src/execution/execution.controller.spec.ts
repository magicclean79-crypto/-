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
  const groupByCalls: { by: string[]; where?: unknown }[] = [];
  const rawQueries: { values: unknown[] }[] = [];
  const prismaMock = {
    // TASK-0605 timeline — date_trunc 집계 결과를 흉내 낸다
    $queryRaw: jest.fn(async (query: { values: unknown[] }) => {
      rawQueries.push(query);
      return [
        {
          bucketStart: new Date("2026-07-28T10:00:00Z"),
          status: "SUCCESS",
          count: 1,
          inputTokens: 100,
          outputTokens: 20,
          cost: "0",
          avgLatencyMs: 10,
          maxLatencyMs: 10,
        },
        {
          bucketStart: new Date("2026-07-28T09:00:00Z"),
          status: "SUCCESS",
          count: 2,
          inputTokens: 200,
          outputTokens: 40,
          cost: "0",
          avgLatencyMs: 5,
          maxLatencyMs: 8,
        },
      ];
    }),
    execution: {
      findMany: jest.fn(
        async ({ where, take }: { where?: { feature?: string }; take: number }) =>
          rows
            .filter((row) => !where?.feature || row.feature === where.feature)
            .slice(0, take),
      ),
      groupBy: jest.fn(
        async ({ by, where }: { by: string[]; where?: unknown }) => {
          groupByCalls.push({ by, where });
          const dimension = by[0] === "status" ? null : by[0];
          const stat = (status: string, count: number) => ({
            status,
            _count: { _all: count },
            _sum: {
              inputTokens: count * 100,
              outputTokens: count * 20,
              cost: status === "SUCCESS" ? "0" : null,
            },
            _avg: { latencyMs: 10 },
            _max: { latencyMs: 25 },
          });
          if (!dimension) {
            return [stat("SUCCESS", 3), stat("FAILED", 1)];
          }
          const keys =
            dimension === "feature"
              ? ["content-generation", "product-analysis"]
              : dimension === "provider"
                ? ["mock"]
                : ["mock-llm-1"];
          return keys.flatMap((key, index) => [
            { [dimension]: key, ...stat("SUCCESS", 2 - index) },
          ]);
        },
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

  it("GET /executions/stats — 전체+차원별 통계 (TASK-0602)", async () => {
    const response = await request(app.getHttpServer())
      .get("/executions/stats")
      .expect(200);

    expect(response.body.range).toEqual({ from: null, to: null });
    expect(response.body.totals).toMatchObject({
      count: 4,
      successCount: 3,
      failedCount: 1,
      successRate: 0.75,
      failureRate: 0.25,
      inputTokens: 400,
      outputTokens: 80,
      cost: 0,
      avgLatencyMs: 10,
      maxLatencyMs: 25,
    });
    // 호출 수 내림차순 정렬
    expect(
      response.body.byFeature.map((item: { key: string }) => item.key),
    ).toEqual(["content-generation", "product-analysis"]);
    expect(response.body.byProvider[0]).toMatchObject({
      key: "mock",
      stats: { count: 2, successRate: 1, failureRate: 0 },
    });
    expect(response.body.byModel[0].key).toBe("mock-llm-1");
  });

  it("GET /executions/stats?from=&to= — 기간 필터가 where로 전달된다", async () => {
    groupByCalls.length = 0;
    const response = await request(app.getHttpServer())
      .get(
        "/executions/stats?from=2026-07-28T00:00:00Z&to=2026-07-28T23:59:59Z",
      )
      .expect(200);

    expect(response.body.range.from).toBe("2026-07-28T00:00:00.000Z");
    expect(groupByCalls).toHaveLength(4);
    expect(groupByCalls[0].where).toEqual({
      createdAt: {
        gte: new Date("2026-07-28T00:00:00Z"),
        lte: new Date("2026-07-28T23:59:59Z"),
      },
    });
  });

  it("GET /executions/stats — 잘못된 날짜·역전 기간은 400", async () => {
    await request(app.getHttpServer())
      .get("/executions/stats?from=not-a-date")
      .expect(400);
    await request(app.getHttpServer())
      .get(
        "/executions/stats?from=2026-07-29T00:00:00Z&to=2026-07-28T00:00:00Z",
      )
      .expect(400);
  });

  it("GET /executions/timeline — 시간 오름차순 버킷 통계 (TASK-0605, 기본 day)", async () => {
    const response = await request(app.getHttpServer())
      .get("/executions/timeline?interval=hour")
      .expect(200);

    expect(response.body.interval).toBe("hour");
    expect(response.body.filter).toEqual({
      feature: null,
      provider: null,
      model: null,
    });
    expect(
      response.body.buckets.map(
        (bucket: { bucketStart: string }) => bucket.bucketStart,
      ),
    ).toEqual(["2026-07-28T09:00:00.000Z", "2026-07-28T10:00:00.000Z"]);
    expect(response.body.buckets[0].stats).toMatchObject({
      count: 2,
      successRate: 1,
      inputTokens: 200,
      cost: 0,
      avgLatencyMs: 5,
      maxLatencyMs: 8,
    });

    const defaulted = await request(app.getHttpServer())
      .get("/executions/timeline")
      .expect(200);
    expect(defaulted.body.interval).toBe("day");
  });

  it("GET /executions/timeline — feature/provider/model 필터가 쿼리에 바인딩된다", async () => {
    rawQueries.length = 0;
    const response = await request(app.getHttpServer())
      .get(
        "/executions/timeline?interval=day&feature=dev&provider=mock&model=mock-llm-1&from=2026-07-28T00:00:00Z",
      )
      .expect(200);

    expect(response.body.filter).toEqual({
      feature: "dev",
      provider: "mock",
      model: "mock-llm-1",
    });
    // Prisma.sql 바인딩 값: interval + from + feature + provider + model
    expect(rawQueries[0].values).toEqual(
      expect.arrayContaining([
        "day",
        "dev",
        "mock",
        "mock-llm-1",
        new Date("2026-07-28T00:00:00Z"),
      ]),
    );
  });

  it("GET /executions/timeline — 잘못된 interval은 400", async () => {
    await request(app.getHttpServer())
      .get("/executions/timeline?interval=month")
      .expect(400);
  });

  it("GET /executions/stats — feature/provider/model 필터가 where에 적용된다 (TASK-0702)", async () => {
    groupByCalls.length = 0;
    await request(app.getHttpServer())
      .get("/executions/stats?feature=dev&provider=mock&model=mock-llm-1")
      .expect(200);

    expect(groupByCalls[0].where).toEqual({
      feature: "dev",
      provider: "mock",
      model: "mock-llm-1",
    });
  });

  it("GET /executions/timeline — hour는 31일 제한 (기본 최근 31일 창, 초과 400) (TASK-0702)", async () => {
    // 명시 범위 31일 초과 → 400
    await request(app.getHttpServer())
      .get(
        "/executions/timeline?interval=hour&from=2026-06-01T00:00:00Z&to=2026-07-28T00:00:00Z",
      )
      .expect(400);

    // from 미지정 → 최근 31일 창이 기본 적용 (createdAt >= 바인딩 존재)
    rawQueries.length = 0;
    await request(app.getHttpServer())
      .get("/executions/timeline?interval=hour")
      .expect(200);
    expect(
      rawQueries[0].values.some((value) => value instanceof Date),
    ).toBe(true);

    // day/week에는 제한이 없다 (전체 기간 조회 허용)
    rawQueries.length = 0;
    await request(app.getHttpServer())
      .get("/executions/timeline?interval=day")
      .expect(200);
    expect(
      rawQueries[0].values.some((value) => value instanceof Date),
    ).toBe(false);
  });
});
