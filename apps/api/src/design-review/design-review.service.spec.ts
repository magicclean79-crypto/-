import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DesignReviewEngine } from "@acos/core";
import type { DesignReviewLlmClient } from "@acos/core";
import type { DesignReview as DesignReviewRecord } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { DesignReviewService } from "./design-review.service";

const validResult = {
  layout: "Hero → 구매포인트 → 특징 → 스펙 순서",
  typography: "제목 20px, 본문 13px",
  whitespace: "충분함",
  imagePlacement: "Hero 사진이 상단 40% 차지",
  colorUsage: "인디고 포인트 컬러",
  visualHierarchy: "제목 → 사진 → 특징",
  purchaseMotivation: "구매 포인트 칩이 눈에 잘 들어옴",
  mobileUx: "스크롤이 자연스러움",
  strengths: ["사진 활용이 좋음"],
  improvements: ["스펙표 폰트가 작음"],
  overallScore: 78,
  summary: "전반적으로 쇼핑몰 상세페이지에 근접한 수준",
};

function createPrismaMock() {
  const rows = new Map<string, DesignReviewRecord>();
  let sequence = 0;
  const prisma = {
    rows,
    image: { findMany: jest.fn() },
    designReview: {
      create: jest.fn(async ({ data }: { data: Partial<DesignReviewRecord> }) => {
        const row = {
          id: `dr-${++sequence}`,
          imageIds: data.imageIds ?? [],
          category: data.category ?? "",
          notes: data.notes ?? null,
          result: data.result ?? null,
          provider: data.provider ?? null,
          error: data.error ?? null,
          createdAt: new Date(),
        } as DesignReviewRecord;
        rows.set(row.id, row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async () => [...rows.values()]),
    },
  };
  return prisma;
}

function stubEngine(complete: DesignReviewLlmClient): DesignReviewEngine {
  return new DesignReviewEngine({
    promptEngine: { render: () => [{ role: "user" as const, content: "x" }] } as never,
    llmProviderName: "gemini",
    complete,
  });
}

const defaultComplete: DesignReviewLlmClient = async () => ({
  provider: "gemini",
  model: "gemini-2.0-flash",
  text: JSON.stringify(validResult),
});

describe("DesignReviewService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    options: { complete?: DesignReviewLlmClient; budget?: unknown } = {},
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DesignReviewService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { getObject: jest.fn(async () => Buffer.from("fake-image")) },
        },
        {
          provide: DesignReviewEngine,
          useValue: stubEngine(options.complete ?? defaultComplete),
        },
        {
          provide: LlmBudgetService,
          useValue: options.budget ?? { assertWithinBudget: jest.fn() },
        },
      ],
    }).compile();
    return moduleRef.get(DesignReviewService);
  }

  const images = [{ id: "img-1", key: "images/1.png", mimeType: "image/png" }];

  it("스크린샷 1장으로 평가를 실행해 SUCCESS 결과를 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma);

    const result = await service.review(["img-1"], "캠핑용품", "Template V1 시안");

    expect(result.status).toBe("SUCCESS");
    expect(result.category).toBe("캠핑용품");
    expect(result.notes).toBe("Template V1 시안");
    expect(result.result).toEqual(validResult);
    expect(result.provider).toBe("gemini");
  });

  it("imageIds가 비어 있으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);
    await expect(service.review([], "캠핑용품")).rejects.toThrow(BadRequestException);
  });

  it("category가 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma);
    await expect(service.review(["img-1"], "")).rejects.toThrow(BadRequestException);
  });

  it("존재하지 않는 이미지가 있으면 404를 던지고 실행 기록을 남기지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue([]);
    const service = await createService(prisma);
    await expect(service.review(["img-1"], "캠핑용품")).rejects.toThrow(NotFoundException);
    expect(prisma.rows.size).toBe(0);
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
    await expect(service.review(["img-1"], "캠핑용품")).rejects.toThrow(/예산을 초과/);
    expect(prisma.rows.size).toBe(0);
  });

  it("응답이 깨지면 FAILED로 기록하고 정상 응답한다 — 5xx로 감추지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const service = await createService(prisma, {
      complete: async () => ({ provider: "gemini", model: "x", text: "이건 JSON이 아니다" }),
    });

    const result = await service.review(["img-1"], "캠핑용품");
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("JSON");
    expect(result.result).toBeNull();
  });

  it("get()은 없는 id에 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);
    await expect(service.get("nope")).rejects.toThrow(NotFoundException);
  });
});
