import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockAnalysisProvider } from "@acos/core";
import type { AnalysisResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { ANALYSIS_PROVIDER } from "./analysis.constants";
import { AnalysisService } from "./analysis.service";
import { PrismaAnalysisRunStore } from "./prisma-analysis-run.store";

function createPrismaMock() {
  const rows = new Map<string, AnalysisResult>();
  let sequence = 0;

  const prisma = {
    rows,
    productUpdates: [] as unknown[],
    product: {
      findUnique: jest.fn(),
      update: jest.fn(async (args: unknown) => {
        prisma.productUpdates.push(args);
        return {};
      }),
    },
    analysisResult: {
      create: jest.fn(async ({ data }: { data: Partial<AnalysisResult> }) => {
        const now = new Date();
        const row = {
          id: `an-${++sequence}`,
          result: null,
          rawJson: null,
          error: null,
          attempts: 0,
          applied: false,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        } as AnalysisResult;
        rows.set(row.id, row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<AnalysisResult>;
        }) => {
          const row = rows.get(where.id) as AnalysisResult;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => ({
          ...(rows.get(where.id) as AnalysisResult),
        }),
      ),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => [...rows.values()]),
    },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  return prisma;
}

const productWithOcr = {
  id: "prod-1",
  name: "원래 이름",
  description: null,
  images: [
    {
      id: "img-1",
      key: "images/a.png",
      mimeType: "image/png",
      ocrResults: [{ extractedText: "Magic Clean PVC Mat\nMade in Korea" }],
    },
  ],
};

describe("AnalysisService (Service Test)", () => {
  async function createService(prisma: ReturnType<typeof createPrismaMock>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnalysisService,
        PrismaAnalysisRunStore,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { getObject: jest.fn(async () => Buffer.from("img")) },
        },
        { provide: ANALYSIS_PROVIDER, useValue: new MockAnalysisProvider() },
      ],
    }).compile();
    return moduleRef.get(AnalysisService);
  }

  it("OCR 텍스트를 입력으로 SUCCESS 결과를 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(productWithOcr);
    const service = await createService(prisma);

    const result = await service.runAnalysis("prod-1", false);

    expect(result.status).toBe("SUCCESS");
    expect(result.provider).toBe("mock");
    expect(result.result?.name).toBe("Magic Clean PVC Mat");
    expect(result.result?.confidence).toBe(0.95);
    expect(result.applied).toBe(false);
    expect(prisma.productUpdates).toHaveLength(0);
  });

  it("apply=true면 결과를 상품에 반영하고 applied를 기록한다", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(productWithOcr);
    const service = await createService(prisma);

    const result = await service.runAnalysis("prod-1", true);

    expect(result.status).toBe("SUCCESS");
    expect(result.applied).toBe(true);
    expect(prisma.productUpdates).toHaveLength(1);
    expect(prisma.productUpdates[0]).toMatchObject({
      where: { id: "prod-1" },
      data: { name: "Magic Clean PVC Mat" },
    });
  });

  it("실행할 때마다 새 레코드가 쌓인다 (1:N 이력)", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(productWithOcr);
    const service = await createService(prisma);

    const first = await service.runAnalysis("prod-1", false);
    const second = await service.runAnalysis("prod-1", false);

    expect(first.id).not.toBe(second.id);
    expect(prisma.rows.size).toBe(2);
  });

  it("존재하지 않는 상품은 404를 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(null);
    const service = await createService(prisma);

    await expect(service.runAnalysis("nope", false)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("결과가 없으면 조회 시 404를 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.analysisResult.findFirst.mockResolvedValue(null);
    const service = await createService(prisma);

    await expect(
      service.getLatestByProductId("prod-1", false),
    ).rejects.toThrow(NotFoundException);
  });
});
