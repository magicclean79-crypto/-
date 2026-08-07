import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductProfileEngine } from "@acos/core";
import type { ProductProfileLlmClient } from "@acos/core";
import type { ProductProfile as ProductProfileRecord } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PrismaProductProfileRunStore } from "./prisma-product-profile-run.store";
import { ProductProfileService } from "./product-profile.service";

const validFeatures = {
  material: "PVC",
  color: "그레이",
  structure: "접이식 매트",
  usage: "주방 바닥 매트",
  components: ["매트 본체"],
  notes: null,
  confidence: 0.8,
};

const validProfile = {
  productName: "Magic Clean PVC 주방 매트",
  brand: "Magic Clean",
  model: null,
  material: "PVC",
  features: ["접이식"],
  specifications: {},
  usage: "주방 바닥에 깔아 사용",
  advantages: ["물세척 가능"],
  warnings: [],
  keywords: ["주방매트"],
  confidence: 0.75,
};

const validCopy = {
  headline: "접어서 보관하는 PVC 주방 매트",
  description: "물세척이 가능한 접이식 PVC 매트로 주방 바닥을 깔끔하게 지켜줍니다.",
};

/** product_profiles 테이블을 흉내 내는 인메모리 Prisma 목업 */
function createPrismaMock() {
  const rows = new Map<string, ProductProfileRecord>();
  let sequence = 0;

  const prisma = {
    rows,
    image: { findMany: jest.fn() },
    ocrResult: { findFirst: jest.fn() },
    productProfile: {
      create: jest.fn(
        async ({ data }: { data: Partial<ProductProfileRecord> }) => {
          const now = new Date();
          const row = {
            id: `pp-${++sequence}`,
            imageIds: data.imageIds ?? [],
            projectId: data.projectId ?? null,
            status: data.status ?? "PENDING",
            ocrText: data.ocrText ?? null,
            imageFeatures: null,
            profile: null,
            pageCopy: null,
            html: null,
            css: null,
            provider: data.provider ?? null,
            error: null,
            attempts: 0,
            startedAt: data.startedAt ?? null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          } as ProductProfileRecord;
          rows.set(row.id, row);
          return { ...row };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ProductProfileRecord>;
        }) => {
          const row = rows.get(where.id) as ProductProfileRecord;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({
        ...(rows.get(where.id) as ProductProfileRecord),
      })),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async () => [...rows.values()]),
    },
  };
  return prisma;
}

function stubEngine(complete: ProductProfileLlmClient): ProductProfileEngine {
  return new ProductProfileEngine({
    promptEngine: {
      render: () => [{ role: "user" as const, content: "x" }],
    } as never,
    llmProviderName: "openai",
    complete,
  });
}

const defaultComplete: ProductProfileLlmClient = async (request) => ({
  provider: "openai",
  model: "gpt-4o",
  text:
    request.step === "vision"
      ? JSON.stringify(validFeatures)
      : request.step === "synthesis"
        ? JSON.stringify(validProfile)
        : JSON.stringify(validCopy),
});

describe("ProductProfileService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    options: {
      complete?: ProductProfileLlmClient;
      budget?: unknown;
    } = {},
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductProfileService,
        PrismaProductProfileRunStore,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { getObject: jest.fn(async () => Buffer.from("fake-image")) },
        },
        {
          provide: ProductProfileEngine,
          useValue: stubEngine(options.complete ?? defaultComplete),
        },
        {
          provide: LlmBudgetService,
          useValue: options.budget ?? { assertWithinBudget: jest.fn() },
        },
      ],
    }).compile();
    return moduleRef.get(ProductProfileService);
  }

  const images = [
    { id: "img-1", key: "images/1.png", mimeType: "image/png" },
    { id: "img-2", key: "images/2.png", mimeType: "image/png" },
  ];

  it("이미지 여러 장으로 STEP 3+4를 실행해 SUCCESS Profile을 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma);

    const result = await service.run(["img-1", "img-2"], "proj-1");

    expect(result.status).toBe("SUCCESS");
    expect(result.imageIds).toEqual(["img-1", "img-2"]);
    expect(result.projectId).toBe("proj-1");
    expect(result.imageFeatures).toEqual(validFeatures);
    expect(result.profile).toEqual(validProfile);
    expect(result.pageCopy).toEqual(validCopy);
    expect(result.html).toContain(validProfile.productName);
    expect(result.css).toContain(".pde-page");
    expect(result.provider).toBe("llm:openai");
  });

  it("imageIds가 비어 있으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await expect(service.run([])).rejects.toThrow(BadRequestException);
    await expect(service.run(["  "])).rejects.toThrow(BadRequestException);
  });

  it("존재하지 않는 이미지가 있으면 404를 던지고 실행 기록을 남기지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue([images[0]]); // img-2 누락
    const service = await createService(prisma);

    await expect(service.run(["img-1", "img-2"])).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.rows.size).toBe(0);
  });

  it("최신 SUCCESS OCR 텍스트를 근거로 넘긴다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue([images[0]]);
    prisma.ocrResult.findFirst.mockResolvedValue({
      extractedText: "Magic Clean PVC Mat",
    });
    const complete = jest.fn(defaultComplete);
    const service = await createService(prisma, { complete });

    const result = await service.run(["img-1"]);

    expect(result.ocrText).toBe("Magic Clean PVC Mat");
    const visionCall = complete.mock.calls.find(([r]) => r.step === "vision")![0];
    expect(visionCall.messages).toBeDefined();
  });

  it("예산을 초과하면 호출 전에 막고 실행 기록을 남기지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma, {
      budget: {
        assertWithinBudget: jest.fn(async () => {
          throw new Error("일간 AI 비용 예산을 초과했습니다");
        }),
      },
    });

    await expect(service.run(["img-1", "img-2"])).rejects.toThrow(/예산을 초과/);
    expect(prisma.rows.size).toBe(0);
  });

  it("이미지 특징 분석(STEP 3) 응답이 깨지면 FAILED로 기록하고 정상 응답한다 — 5xx로 감추지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma, {
      complete: async (request) =>
        request.step === "vision"
          ? { provider: "openai", model: "gpt-4o", text: "이건 JSON이 아니다" }
          : defaultComplete(request),
    });

    const result = await service.run(["img-1", "img-2"]);

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("JSON");
    expect(result.profile).toBeNull();
  });

  it("STEP 4는 이미지를 재첨부하지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const complete = jest.fn(defaultComplete);
    const service = await createService(prisma, { complete });

    await service.run(["img-1", "img-2"]);

    const synthesisCall = complete.mock.calls.find(
      ([r]) => r.step === "synthesis",
    )![0];
    expect(synthesisCall.images).toEqual([]);
  });

  it("get()은 없는 id에 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);
    await expect(service.get("nope")).rejects.toThrow(NotFoundException);
  });

  it("getHtmlDocument()는 SUCCESS 실행의 HTML을 완전한 문서로 감싸 반환한다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma);
    const run = await service.run(["img-1", "img-2"]);

    const doc = await service.getHtmlDocument(run.id);
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain(validProfile.productName);
    expect(doc).toContain(validCopy.headline);
  });

  it("getHtmlDocument()는 없는 id에 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);
    await expect(service.getHtmlDocument("nope")).rejects.toThrow(NotFoundException);
  });

  it("getHtmlDocument()는 FAILED 실행처럼 html이 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma, {
      complete: async (request) =>
        request.step === "vision"
          ? { provider: "openai", model: "gpt-4o", text: "이건 JSON이 아니다" }
          : defaultComplete(request),
    });
    const run = await service.run(["img-1", "img-2"]);

    expect(run.status).toBe("FAILED");
    await expect(service.getHtmlDocument(run.id)).rejects.toThrow(
      BadRequestException,
    );
  });
});
