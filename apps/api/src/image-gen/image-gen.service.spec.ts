import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ImageEditProvider, ImageEditRequest, ImageEditResult } from "@acos/core";
import type { Image as ImageRecord } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { IMAGE_EDIT_PROVIDER } from "./image-gen.constants";
import { ImageGenService } from "./image-gen.service";

function createPrismaMock() {
  const rows = new Map<string, ImageRecord>();
  let sequence = 0;
  const seed = (row: Partial<ImageRecord> & { id: string }) => {
    rows.set(row.id, {
      key: `images/${row.id}.jpg`,
      url: `https://example.com/${row.id}.jpg`,
      originalName: `${row.id}.jpg`,
      mimeType: "image/jpeg",
      size: 100,
      productId: null,
      projectId: null,
      kind: "ORIGINAL",
      sourceImageId: null,
      generationMetadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...row,
    } as ImageRecord);
  };
  const prisma = {
    rows,
    seed,
    image: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
      create: jest.fn(async ({ data }: { data: Partial<ImageRecord> }) => {
        const row = {
          id: `img-${++sequence}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          productId: null,
          projectId: null,
          sourceImageId: null,
          generationMetadata: null,
          ...data,
        } as ImageRecord;
        rows.set(row.id, row);
        return { ...row };
      }),
    },
  };
  return prisma;
}

function createStorageMock() {
  return {
    getObject: jest.fn(async () => Buffer.from("fake-bytes")),
    putObject: jest.fn(async (key: string) => `https://example.com/${key}`),
  };
}

function createProviderMock(edit: jest.Mock<Promise<ImageEditResult>, [ImageEditRequest]>): ImageEditProvider {
  return { name: "gemini", defaultModel: "gemini-2.5-flash-image", edit };
}

const fakeResult: ImageEditResult = {
  provider: "gemini",
  model: "gemini-2.5-flash-image",
  imageBytes: "ZmFrZS1yZXN1bHQ=",
  mimeType: "image/png",
  text: null,
  raw: {},
};

describe("ImageGenService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    edit: jest.Mock,
    options: { budget?: unknown } = {},
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImageGenService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: createStorageMock() },
        { provide: IMAGE_EDIT_PROVIDER, useValue: createProviderMock(edit) },
        {
          provide: LlmBudgetService,
          useValue: options.budget ?? { assertWithinBudget: jest.fn() },
        },
      ],
    }).compile();
    return moduleRef.get(ImageGenService);
  }

  it("removeBackground: 원본 이미지 1장을 Provider에 보내고 BACKGROUND_REMOVED 이미지를 새로 만든다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.removeBackground("img-1");

    expect(result.kind).toBe("BACKGROUND_REMOVED");
    expect(result.sourceImageId).toBe("img-1");
    expect(edit.mock.calls[0][0].images).toHaveLength(1);
  });

  it("존재하지 않는 이미지면 404를 던지고 새 레코드를 만들지 않는다", async () => {
    const prisma = createPrismaMock();
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.removeBackground("missing")).rejects.toThrow(NotFoundException);
    expect(prisma.image.create).not.toHaveBeenCalled();
  });

  it("generateBackground: 배경만 생성하고 BACKGROUND_GENERATED로 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateBackground("img-1", "밝은 베란다");

    expect(result.kind).toBe("BACKGROUND_GENERATED");
    expect(edit.mock.calls[0][0].prompt).toContain("밝은 베란다");
  });

  it("composite: 제품+배경 이미지 2장을 함께 보내고 COMPOSITED로 저장하며 배경 id를 메타데이터에 남긴다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "product-1", sourceImageId: "original-1" });
    prisma.seed({ id: "bg-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.composite("product-1", "bg-1");

    expect(result.kind).toBe("COMPOSITED");
    expect(result.sourceImageId).toBe("original-1");
    expect(edit.mock.calls[0][0].images).toHaveLength(2);
    expect(result.generationMetadata?.backgroundImageId).toBe("bg-1");
  });

  it("generateHero: 배경 제거 → 배경 생성 → 합성을 순서대로 실행해 4개 이미지를 모두 반환한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateHero("img-1");

    expect(result.original.id).toBe("img-1");
    expect(result.backgroundRemoved.kind).toBe("BACKGROUND_REMOVED");
    expect(result.backgroundGenerated.kind).toBe("BACKGROUND_GENERATED");
    expect(result.composited.kind).toBe("COMPOSITED");
    expect(edit).toHaveBeenCalledTimes(3);
  });

  it("예산이 초과되면 Provider를 호출하지 않고 예외를 그대로 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const budget = {
      assertWithinBudget: jest.fn(() => {
        throw new Error("budget exceeded");
      }),
    };
    const service = await createService(prisma, edit, { budget });

    await expect(service.removeBackground("img-1")).rejects.toThrow("budget exceeded");
    expect(edit).not.toHaveBeenCalled();
    expect(prisma.image.create).not.toHaveBeenCalled();
  });

  it("generateUsageShots: 배경 제거 1번 + 지정한 개수만큼 사용 장면 샷을 생성한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateUsageShots("img-1", "베란다에서 청소하는 모습", 3);

    expect(result.original.id).toBe("img-1");
    expect(result.backgroundRemoved.kind).toBe("BACKGROUND_REMOVED");
    expect(result.shots).toHaveLength(3);
    expect(result.failedCount).toBe(0);
    // 배경 제거 1번 + 샷 3번 = 4번 호출
    expect(edit).toHaveBeenCalledTimes(4);
    result.shots.forEach((shot) => expect(shot.kind).toBe("COMPOSITED"));
  });

  it("generateUsageShots: shotCount는 1~6으로 클램프된다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn(async (_req: ImageEditRequest) => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateUsageShots("img-1", undefined, 99);

    expect(result.shots).toHaveLength(6);
  });

  it("generateUsageShots: 일부 샷이 실패해도 나머지는 그대로 반환하고 failedCount로 알려준다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    let calls = 0;
    const edit = jest.fn(async (_req: ImageEditRequest) => {
      calls++;
      // 1번째 호출(배경 제거)은 성공, 2번째 샷 호출만 실패시킨다
      if (calls === 2) throw new Error("Gemini 오류");
      return fakeResult;
    });
    const service = await createService(prisma, edit);

    const result = await service.generateUsageShots("img-1", undefined, 3);

    expect(result.shots).toHaveLength(2);
    expect(result.failedCount).toBe(1);
  });
});
