import { BadRequestException, NotFoundException } from "@nestjs/common";
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
  const productProfiles: {
    id: string;
    imageIds: string[];
    profile: unknown;
    ocrText: string | null;
    updatedAt: Date;
    userRequirement?: string | null;
    userRequirementsByCategory?: unknown;
  }[] = [];
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
      selected: false,
      locked: false,
      ...row,
    } as ImageRecord);
  };
  const seedProductProfile = (input: {
    id: string;
    imageIds: string[];
    profile: unknown;
    ocrText?: string | null;
    userRequirement?: string | null;
    userRequirementsByCategory?: unknown;
  }) => {
    productProfiles.push({
      ocrText: null,
      updatedAt: new Date(),
      ...input,
    });
  };
  const prisma = {
    rows,
    seed,
    seedProductProfile,
    image: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
      findFirst: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where: {
            sourceImageId?: string;
            kind?: string;
            category?: string;
            selected?: boolean;
            locked?: boolean;
          };
          orderBy?: { createdAt?: string; groupVersion?: string };
        }) => {
          const matches = [...rows.values()].filter(
            (row) =>
              (where.sourceImageId === undefined || row.sourceImageId === where.sourceImageId) &&
              (where.kind === undefined || row.kind === where.kind) &&
              (where.category === undefined || row.category === where.category) &&
              (where.selected === undefined || Boolean(row.selected) === where.selected) &&
              (where.locked === undefined || Boolean(row.locked) === where.locked),
          );
          if (matches.length === 0) return null;
          if (orderBy?.groupVersion === "desc") {
            return matches.sort((a, b) => (b.groupVersion ?? 0) - (a.groupVersion ?? 0))[0];
          }
          return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        },
      ),
      create: jest.fn(async ({ data }: { data: Partial<ImageRecord> }) => {
        const row = {
          id: `img-${++sequence}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          productId: null,
          projectId: null,
          sourceImageId: null,
          generationMetadata: null,
          selected: false,
          locked: false,
          ...data,
        } as ImageRecord;
        rows.set(row.id, row);
        return { ...row };
      }),
      // 제품 동일성을 위해 같은 프로젝트의 다른 원본 사진도 참고로 넘긴다
      // (CTO 지시, 2026-08-08).
      findMany: jest.fn(
        async ({
          where,
          take,
        }: {
          where: {
            projectId?: string | null;
            kind?: string;
            id?: { not?: string; in?: string[] };
            photoType?: string;
          };
          take?: number;
        }) => {
          const matches = [...rows.values()].filter(
            (row) =>
              (where.projectId === undefined || row.projectId === where.projectId) &&
              (where.kind === undefined || row.kind === where.kind) &&
              (where.id?.not === undefined || row.id !== where.id.not) &&
              (where.id?.in === undefined || where.id.in.includes(row.id)) &&
              (where.photoType === undefined || row.photoType === where.photoType),
          );
          return matches.slice(0, take ?? matches.length).map((row) => ({ ...row }));
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<ImageRecord> }) => {
          const existing = rows.get(where.id);
          if (!existing) throw new Error(`no row: ${where.id}`);
          const updated = { ...existing, ...data } as ImageRecord;
          rows.set(where.id, updated);
          return { ...updated };
        },
      ),
    },
    productProfile: {
      findFirst: jest.fn(async ({ where }: { where: { imageIds: { has: string } } }) => {
        const matches = productProfiles.filter((p) => p.imageIds.includes(where.imageIds.has));
        if (matches.length === 0) return null;
        return matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
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

/**
 * 이미지 생성 경로는 모두 Product Profile을 먼저 요구한다 (CTO 지시,
 * 2026-08-08 — Sprint 1 규칙 1). 그 경로를 검사하려면 프로필이 먼저 있어야
 * 하므로 준비를 한 곳에 모은다.
 */
function seedProfileFor(prisma: ReturnType<typeof createPrismaMock>, imageId: string) {
  prisma.seedProductProfile({
    id: `profile-${imageId}`,
    imageIds: [imageId],
    ocrText: "Magic Clean PVC Mat",
    profile: {
      productName: "매직클린 PVC 매트",
      brand: null,
      model: null,
      material: "PVC",
      features: ["접이식"],
      specifications: { size: "60x90cm" },
      usage: null,
      advantages: [],
      warnings: [],
      keywords: [],
      confidence: 0.8,
    },
  });
}

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

  it("generateAuxiliaryVisual: 참조 이미지 없이(0장) Provider를 호출하고 결과를 저장하지 않는다 (T1-123)", async () => {
    const prisma = createPrismaMock();
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateAuxiliaryVisual("추상 배경 그래픽을 만들어줘");

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0].prompt).toBe("추상 배경 그래픽을 만들어줘");
    expect(edit.mock.calls[0][0].images).toEqual([]);
    // T1-152: 장식용 보조 그래픽은 "low"로 호출한다 — GPT Image 2의
    // quality:"high"가 장당 100초 이상 걸려(실측), Story 하나에서 최대
    // 10장을 순차 호출하면 요청 전체가 멈춘 것처럼 보이는 원인이었다.
    expect(edit.mock.calls[0][0].quality).toBe("low");
    expect(result.imageBytes).toBe(fakeResult.imageBytes);
    expect(result.mimeType).toBe(fakeResult.mimeType);
    expect(prisma.image.create).not.toHaveBeenCalled();
  });

  it("generateAuxiliaryVisual: 호출 전에 비용 예산을 확인한다 (T1-123)", async () => {
    const prisma = createPrismaMock();
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const budget = { assertWithinBudget: jest.fn() };
    const service = await createService(prisma, edit, { budget });

    await service.generateAuxiliaryVisual("추상 배경 그래픽을 만들어줘");

    expect(budget.assertWithinBudget).toHaveBeenCalledWith({ what: "상세페이지 보조 그래픽 생성 (Gemini)" });
  });

  it("generateDesignAsset: 참조 이미지 없이(0장) Provider를 호출하고 결과를 저장하지 않는다 (T1-142)", async () => {
    const prisma = createPrismaMock();
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateDesignAsset("주의사항 아이콘을 만들어줘");

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0].prompt).toBe("주의사항 아이콘을 만들어줘");
    expect(edit.mock.calls[0][0].images).toEqual([]);
    expect(edit.mock.calls[0][0].quality).toBe("low");
    expect(result.imageBytes).toBe(fakeResult.imageBytes);
    expect(result.mimeType).toBe(fakeResult.mimeType);
    expect(prisma.image.create).not.toHaveBeenCalled();
  });

  it("generateDesignAsset: 호출 전에 비용 예산을 확인하며, generateAuxiliaryVisual과 다른 사유 문구를 쓴다 (T1-142)", async () => {
    const prisma = createPrismaMock();
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const budget = { assertWithinBudget: jest.fn() };
    const service = await createService(prisma, edit, { budget });

    await service.generateDesignAsset("주의사항 아이콘을 만들어줘");

    expect(budget.assertWithinBudget).toHaveBeenCalledWith({
      what: "상세페이지 생성형 타이포그래피/아이콘 자산 생성 (Gemini)",
    });
  });

  it("removeBackground: 원본 이미지 1장을 Provider에 보내고 BACKGROUND_REMOVED 이미지를 새로 만든다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.removeBackground("img-1");

    expect(result.kind).toBe("BACKGROUND_REMOVED");
    expect(result.sourceImageId).toBe("img-1");
    expect(edit.mock.calls[0][0].images).toHaveLength(1);
  });

  it("removeBackground: 포장지(INFO)는 Gemini에 보내지 않고 거부한다 (T1-26)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "pkg-1", photoType: "INFO" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.removeBackground("pkg-1")).rejects.toThrow(BadRequestException);
    expect(edit).not.toHaveBeenCalled();
  });

  it("존재하지 않는 이미지면 404를 던지고 새 레코드를 만들지 않는다", async () => {
    const prisma = createPrismaMock();
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.removeBackground("missing")).rejects.toThrow(NotFoundException);
    expect(prisma.image.create).not.toHaveBeenCalled();
  });

  it("generateBackground: 배경만 생성하고 BACKGROUND_GENERATED로 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateBackground("img-1", "밝은 베란다");

    expect(result.kind).toBe("BACKGROUND_GENERATED");
    expect(edit.mock.calls[0][0].prompt).toContain("밝은 베란다");
  });

  it("generateBackground: 포장지(INFO)는 Gemini에 보내지 않고 거부한다 (T1-26)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "pkg-1", photoType: "INFO" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.generateBackground("pkg-1", "밝은 베란다")).rejects.toThrow(
      BadRequestException,
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it("composite: 제품+배경 이미지 2장을 함께 보내고 COMPOSITED로 저장하며 배경 id를 메타데이터에 남긴다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "product-1", sourceImageId: "original-1" });
    prisma.seed({ id: "bg-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.composite("product-1", "bg-1");

    expect(result.kind).toBe("COMPOSITED");
    expect(result.sourceImageId).toBe("original-1");
    expect(edit.mock.calls[0][0].images).toHaveLength(2);
    expect(result.generationMetadata?.backgroundImageId).toBe("bg-1");
  });

  it("composite: 제품 사진이 포장지(INFO)면 Gemini에 보내지 않고 거부한다 (T1-26)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "pkg-1", photoType: "INFO" });
    prisma.seed({ id: "bg-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.composite("pkg-1", "bg-1")).rejects.toThrow(BadRequestException);
    expect(edit).not.toHaveBeenCalled();
  });

  it("composite: 배경 사진이 포장지(INFO)면 Gemini에 보내지 않고 거부한다 (T1-26)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "product-1" });
    prisma.seed({ id: "pkg-1", photoType: "INFO" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.composite("product-1", "pkg-1")).rejects.toThrow(BadRequestException);
    expect(edit).not.toHaveBeenCalled();
  });

  it("generateHero: 배경 제거 → 배경 생성 → 합성을 순서대로 실행해 4개 이미지를 모두 반환한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
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
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
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
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
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
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateUsageShots("img-1", undefined, 99);

    expect(result.shots).toHaveLength(6);
  });

  it("generateUsageShots: 일부 샷이 실패해도 나머지는 그대로 반환하고 failedCount로 알려준다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    let calls = 0;
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => {
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

  it("generateHero도 Product Profile이 없으면 400을 던진다 — 경로마다 동작이 달라지지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.generateHero("img-1")).rejects.toThrow(BadRequestException);
    expect(edit).not.toHaveBeenCalled();
  });

  it("generateUsageShots도 Product Profile이 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.generateUsageShots("img-1", undefined, 2)).rejects.toThrow(
      BadRequestException,
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it("모든 생성 경로가 같은 Prompt Builder를 쓴다 — 제품 정보와 글자 금지 규칙이 항상 붙는다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await service.generateUsageShots("img-1", "베란다 청소", 2);

    // 배경 제거 1번 + 샷 2번 = 3번. 세 프롬프트 모두 같은 규칙을 담아야 한다.
    expect(edit).toHaveBeenCalledTimes(3);
    for (const [request] of edit.mock.calls) {
      expect(request.prompt).toContain("제품명: 매직클린 PVC 매트");
      expect(request.prompt).toContain("제품명을 이미지 안에 글자로 그리지 않는다");
      expect(request.prompt).toContain("스펙표·수치·단위를 이미지 안에 글자로 넣지 않는다");
    }
  });

  it("generateImageCandidates: 이 사진으로 만든 Product Profile이 없으면 400을 던지고 생성하지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.generateImageCandidates("img-1", "HERO", {})).rejects.toThrow(
      BadRequestException,
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it("generateImageCandidates: 포장지(INFO)는 Gemini에 전달하지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1", projectId: "proj-1", photoType: "DESIGN" });
    prisma.seed({ id: "img-2", projectId: "proj-1", photoType: "DESIGN" });
    // 포장지·라벨 — 정보 추출 전용이므로 Gemini에 가면 안 된다
    prisma.seed({ id: "pkg-1", projectId: "proj-1", photoType: "INFO" });
    prisma.seed({ id: "pkg-2", projectId: "proj-1", photoType: "INFO" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const last = edit.mock.calls[edit.mock.calls.length - 1][0];
    // 배경 제거본 + 원본 + DESIGN 1장 = 3장. INFO 2장은 빠진다.
    expect(last.images).toHaveLength(3);

    const meta = result.candidates[0].generationMetadata;
    expect(meta?.referenceImages?.map((r) => r.id)).not.toContain("pkg-1");
    expect(meta?.referenceImages?.map((r) => r.id)).not.toContain("pkg-2");
    // 화면에서 "OCR 전용"으로 보여 줄 목록에는 들어간다
    expect(meta?.excludedInfoImages?.map((r) => r.id).sort()).toEqual(["pkg-1", "pkg-2"]);
  });

  it("generateImageCandidates: 분류되지 않은 사진(null)도 전달하지 않는다 — 모르는 것을 통과시키지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1", projectId: "proj-1", photoType: "DESIGN" });
    prisma.seed({ id: "unknown-1", projectId: "proj-1" }); // photoType 없음
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const last = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(last.images).toHaveLength(2); // 배경 제거본 + 원본만
  });

  it("generateImageCandidates: 원본이 포장지(INFO)면 생성을 거부한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "pkg-1", projectId: "proj-1", photoType: "INFO" });
    seedProfileFor(prisma, "pkg-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.generateImageCandidates("pkg-1", "HERO", {})).rejects.toThrow(
      BadRequestException,
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it("generateImageCandidates: 배경 제거본·원본 + 같은 프로젝트의 다른 사진을 함께 보낸다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1", projectId: "proj-1", photoType: "DESIGN" });
    // 같은 프로젝트의 다른 제품 사진 — 구성품·디테일 확인용
    prisma.seed({ id: "img-2", projectId: "proj-1", photoType: "DESIGN" });
    prisma.seed({ id: "img-3", projectId: "proj-1", photoType: "DESIGN" });
    // 다른 프로젝트 사진은 섞이면 안 된다
    prisma.seed({ id: "other-1", projectId: "proj-2", photoType: "DESIGN" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    // 배경 제거(1번) + 후보 생성(1번). 후보 생성이 마지막 호출이다.
    const last = edit.mock.calls[edit.mock.calls.length - 1][0];
    // 배경 제거본 + 원본 + 같은 프로젝트 사진 2장 = 4장
    expect(last.images).toHaveLength(4);
    expect(last.prompt).toContain("세 번째 이후 이미지(2장)는 같은 제품의 다른 사진이다");
    expect(last.prompt).toContain("제공된 이미지는 모두 같은 하나의 제품이며");
  });

  it("generateImageCandidates: 다른 사진이 없으면 배경 제거본·원본 2장만 보낸다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1", projectId: "proj-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const last = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(last.images).toHaveLength(2);
    expect(last.prompt).not.toContain("세 번째 이후 이미지");
  });

  it("generateImageCandidates: Product Package의 제품 정보를 프롬프트에 반영하고 결과에 스냅샷을 남긴다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    prisma.seedProductProfile({
      id: "profile-1",
      imageIds: ["img-1"],
      ocrText: "Magic Clean PVC Mat",
      profile: {
        productName: "매직클린 PVC 매트",
        brand: null,
        model: null,
        material: "PVC",
        features: ["접이식"],
        specifications: { size: "60x90cm" },
        usage: null,
        advantages: [],
        warnings: [],
        keywords: [],
        confidence: 0.8,
      },
    });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => ({
      ...fakeResult,
      text: "생성 완료",
    }));
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    expect(result.candidates).toHaveLength(1);
    // 배경 제거(1번) + 후보 생성(1번) = 2번 호출 — 후보 생성 프롬프트는 마지막 호출
    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("제품명: 매직클린 PVC 매트");
    const prompt = lastCall.prompt;
    expect(prompt).toContain("주요 특징: 접이식");
    const candidate = result.candidates[0];
    expect(candidate.generationMetadata?.productPackage?.productName).toBe("매직클린 PVC 매트");
    expect(candidate.generationMetadata?.rawResponseText).toBe("생성 완료");
  });

  it("generateImageCandidates: 저장된 사용자 요구사항(T1-92)을 Product Package에 실어 Gemini 프롬프트에 전달한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    prisma.seedProductProfile({
      id: "profile-1",
      imageIds: ["img-1"],
      profile: {
        productName: "매직클린 PVC 매트",
        brand: null,
        model: null,
        material: "PVC",
        features: [],
        specifications: {},
        usage: null,
        advantages: [],
        warnings: [],
        keywords: [],
        confidence: 0.8,
      },
      userRequirement: "더 고급스러운 느낌으로 만들어줘",
    });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("[사용자 요구사항 — 참고]");
    expect(lastCall.prompt).toContain("더 고급스러운 느낌으로 만들어줘");
    expect(result.candidates[0].generationMetadata?.productPackage?.userRequirement).toBe(
      "더 고급스러운 느낌으로 만들어줘",
    );
  });

  it("generateImageCandidates: 목적별 요구사항(T1-99)이 있으면 공용 요구사항 대신 그 카테고리의 값을 프롬프트에 실어 보낸다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    prisma.seedProductProfile({
      id: "profile-1",
      imageIds: ["img-1"],
      profile: {
        productName: "매직클린 PVC 매트",
        brand: null,
        model: null,
        material: "PVC",
        features: [],
        specifications: {},
        usage: null,
        advantages: [],
        warnings: [],
        keywords: [],
        confidence: 0.8,
      },
      userRequirement: "공용 요구사항 — 전체 톤을 고급스럽게",
      userRequirementsByCategory: { HERO: "대표 썸네일은 화이트 배경으로", DETAIL: "디테일샷은 이음새를 크게" },
    });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("대표 썸네일은 화이트 배경으로");
    expect(lastCall.prompt).not.toContain("공용 요구사항 — 전체 톤을 고급스럽게");
    expect(result.candidates[0].generationMetadata?.productPackage?.userRequirement).toBe(
      "대표 썸네일은 화이트 배경으로",
    );
  });

  it("generateImageCandidates: 이 카테고리에 목적별 요구사항이 없으면 공용 요구사항으로 폴백한다(하위 호환)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    prisma.seedProductProfile({
      id: "profile-1",
      imageIds: ["img-1"],
      profile: {
        productName: "매직클린 PVC 매트",
        brand: null,
        model: null,
        material: "PVC",
        features: [],
        specifications: {},
        usage: null,
        advantages: [],
        warnings: [],
        keywords: [],
        confidence: 0.8,
      },
      userRequirement: "공용 요구사항 — 전체 톤을 고급스럽게",
      userRequirementsByCategory: { DETAIL: "디테일샷은 이음새를 크게" },
    });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("공용 요구사항 — 전체 톤을 고급스럽게");
    expect(result.candidates[0].generationMetadata?.productPackage?.userRequirement).toBe(
      "공용 요구사항 — 전체 톤을 고급스럽게",
    );
  });

  it("getImagesByIds: 지정한 id들의 메타데이터(photoType 포함)를 반환한다 — INFO/DESIGN 구분용(T1-99)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "design-1", photoType: "DESIGN" });
    prisma.seed({ id: "info-1", photoType: "INFO" });
    prisma.seed({ id: "unclassified-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const results = await service.getImagesByIds(["design-1", "info-1", "unclassified-1", "missing-1"]);

    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("design-1")?.photoType).toBe("DESIGN");
    expect(byId.get("info-1")?.photoType).toBe("INFO");
    expect(byId.get("unclassified-1")?.photoType ?? null).toBeNull();
    expect(byId.has("missing-1")).toBe(false);
  });

  it("selectImage: 같은 카테고리에서 여러 장을 동시에 선택할 수 있다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "cand-1", sourceImageId: "img-1", category: "HERO", selected: false });
    prisma.seed({ id: "cand-2", sourceImageId: "img-1", category: "HERO", selected: false });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const first = await service.selectImage("cand-1");
    const second = await service.selectImage("cand-2");

    expect(first.selected).toBe(true);
    expect(second.selected).toBe(true);
  });

  it("selectImage: 이미 선택된 이미지를 다시 누르면 선택 해제된다(토글)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "cand-1", sourceImageId: "img-1", category: "HERO", selected: false });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const selected = await service.selectImage("cand-1");
    const deselected = await service.selectImage("cand-1");

    expect(selected.selected).toBe(true);
    expect(deselected.selected).toBe(false);
  });

  it("selectImage: 사람이 직접 선택하면 명시적 고정(locked)도 함께 켜지고, 해제하면 함께 풀린다 (T1-155)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "cand-1", sourceImageId: "img-1", category: "HERO", selected: false, locked: false });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const selected = await service.selectImage("cand-1");
    expect(selected.selected).toBe(true);
    expect(selected.locked).toBe(true);

    const deselected = await service.selectImage("cand-1");
    expect(deselected.selected).toBe(false);
    expect(deselected.locked).toBe(false);
  });

  it("selectImage: 카테고리가 없는 이미지는 선택할 수 없다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.selectImage("img-1")).rejects.toThrow(BadRequestException);
  });

  it("selectOriginalAsAsset: 실제 업로드 원본을 Gemini 호출 없이 그대로 카테고리 asset으로 지정한다(T1-144)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "orig-1", kind: "ORIGINAL", photoType: "DESIGN", category: null, selected: false });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.selectOriginalAsAsset("orig-1", "COMPONENTS");

    expect(result.category).toBe("COMPONENTS");
    expect(result.selected).toBe(true);
    // 이 호출 자체가 사람의 명시적 선택이다 — locked도 함께 켜진다 (T1-155).
    expect(result.locked).toBe(true);
    expect(result.kind).toBe("ORIGINAL");
    expect(edit).not.toHaveBeenCalled();
  });

  it("selectOriginalAsAsset: Gemini가 만든 이미지(ORIGINAL 아님)는 거부한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "gen-1", kind: "COMPOSITED", sourceImageId: "orig-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.selectOriginalAsAsset("gen-1", "COMPONENTS")).rejects.toThrow(BadRequestException);
  });

  it("selectOriginalAsAsset: 포장지·라벨(INFO) 원본은 거부한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "info-1", kind: "ORIGINAL", photoType: "INFO" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.selectOriginalAsAsset("info-1", "COMPONENTS")).rejects.toThrow(BadRequestException);
  });

  // ---------------------------------------------------------------------
  // T1-149 — Art Direction Contract / reference hierarchy / asset metadata
  // ---------------------------------------------------------------------

  it("generateImageCandidates: 카테고리 기본 프롬프트 대신 Art Direction Contract(canvas·초점·배치·조명·팔레트)를 instruction으로 쓴다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("Art Direction Contract");
    expect(lastCall.prompt).toContain("캔버스 비율");
    expect(lastCall.prompt).toContain("팔레트");
    expect(lastCall.prompt).toContain("teal");
  });

  it("generateImageCandidates: scenePrompt을 명시하면 Art Direction Contract 대신 그 문장을 그대로 쓴다(하위 호환)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await service.generateImageCandidates("img-1", "HERO", { count: 1, scenePrompt: "커스텀 장면 지시문" });

    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("커스텀 장면 지시문");
    expect(lastCall.prompt).not.toContain("Art Direction Contract");
  });

  it("generateImageCandidates: 실제 원본 참조 사진을 reference hierarchy 순서(HERO→DETAIL→COMPONENTS→미지정)로 정렬해 보낸다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1", projectId: "proj-1", photoType: "DESIGN" });
    // 의도적으로 우선순위 역순으로 심는다 — createdAt만으로는 이 순서가 나오지 않는다.
    prisma.seed({ id: "untagged-1", projectId: "proj-1", photoType: "DESIGN", category: null });
    prisma.seed({ id: "components-1", projectId: "proj-1", photoType: "DESIGN", category: "COMPONENTS" });
    prisma.seed({ id: "detail-1", projectId: "proj-1", photoType: "DESIGN", category: "DETAIL" });
    prisma.seed({ id: "hero-1", projectId: "proj-1", photoType: "DESIGN", category: "HERO" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "FEATURE_HIGHLIGHT", { count: 1 });

    const referenceIds = result.candidates[0].generationMetadata?.referenceImages?.map((r) => r.id) ?? [];
    // 앞 두 자리는 항상 배경 제거본·원본이고, 그 다음이 reference hierarchy 순서다.
    expect(referenceIds.slice(2)).toEqual(["hero-1", "detail-1", "components-1", "untagged-1"]);
  });

  it("generateImageCandidates: COMPONENTS 카테고리는 실제 구성품 참조도 Product Profile 구성품 사실도 없으면 생성을 거부한다(구성품 발명 방지)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1"); // features: ["접이식"], specifications: { size: "60x90cm" } — 구성품 언급 없음
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.generateImageCandidates("img-1", "COMPONENTS", { count: 1 })).rejects.toThrow(
      BadRequestException,
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it("generateImageCandidates: COMPONENTS 카테고리는 실제 구성품 참조 사진이 있으면 허용한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1", projectId: "proj-1", photoType: "DESIGN" });
    prisma.seed({ id: "components-1", projectId: "proj-1", photoType: "DESIGN", category: "COMPONENTS" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "COMPONENTS", { count: 1 });

    expect(result.candidates).toHaveLength(1);
  });

  it("generateImageCandidates: COMPONENTS 카테고리는 Product Profile에 구성품 사실이 있으면 실제 참조 사진 없이도 허용한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    prisma.seedProductProfile({
      id: "profile-1",
      imageIds: ["img-1"],
      profile: {
        productName: "베란다용 스텐 호스 세트",
        brand: null,
        model: null,
        material: "스테인리스",
        features: ["구성품: 고무 패킹 2개"],
        specifications: {},
        usage: null,
        advantages: [],
        warnings: [],
        keywords: [],
        confidence: 0.8,
      },
    });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "COMPONENTS", { count: 1 });

    expect(result.candidates).toHaveLength(1);
  });

  it("generateImageCandidates: 생성된 asset에 productId/category/purpose/referenceIds/version/artDirectionContractId metadata를 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "DETAIL", { count: 1 });

    const metadata = result.candidates[0].generationMetadata as unknown as {
      compositionMetadata?: {
        productId: string;
        category: string;
        purpose: string;
        referenceIds: string[];
        version: number;
        artDirectionContractId: string;
        provider: string;
        model: string;
      };
    };
    expect(metadata.compositionMetadata?.productId).toBe("profile-img-1");
    expect(metadata.compositionMetadata?.category).toBe("DETAIL");
    expect(metadata.compositionMetadata?.artDirectionContractId).toBe("art-direction:detail:v1");
    expect(metadata.compositionMetadata?.version).toBe(1);
    expect(metadata.compositionMetadata?.referenceIds.length).toBeGreaterThan(0);
    expect(metadata.compositionMetadata?.purpose).toBeTruthy();
    // T1-150 — 어느 Provider/모델이 이 asset을 만들었는지 asset 단위로 남긴다
    expect(metadata.compositionMetadata?.provider).toBeTruthy();
    expect(metadata.compositionMetadata?.model).toBeTruthy();
  });

  it("generateImageCandidates: 같은 카테고리를 다시 생성하면 artDirectionContractId는 그대로이고 version만 올라간다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const first = await service.generateImageCandidates("img-1", "HERO", { count: 1 });
    const second = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    const firstMeta = (first.candidates[0].generationMetadata as unknown as { compositionMetadata: { version: number; artDirectionContractId: string } }).compositionMetadata;
    const secondMeta = (second.candidates[0].generationMetadata as unknown as { compositionMetadata: { version: number; artDirectionContractId: string } }).compositionMetadata;
    expect(firstMeta.artDirectionContractId).toBe(secondMeta.artDirectionContractId);
    expect(secondMeta.version).toBe(firstMeta.version + 1);
  });

  it("generateImageCandidates: storySectionPurpose를 Art Direction Contract의 purpose에 threading한다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "USAGE_SCENE", {
      count: 1,
      storySectionPurpose: "베란다 청소 상황 제시",
    });

    const metadata = result.candidates[0].generationMetadata as unknown as {
      compositionMetadata?: { purpose: string };
    };
    expect(metadata.compositionMetadata?.purpose).toContain("베란다 청소 상황 제시");
    const lastCall = edit.mock.calls[edit.mock.calls.length - 1][0];
    expect(lastCall.prompt).toContain("베란다 청소 상황 제시");
  });

  it("generateImageCandidates: 새로 생성된 후보는 사람이 다시 선택하지 않아도 자동으로 selected 상태로 승격된다 — locked는 켜지 않는다 (T1-155)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    expect(result.candidates[0].selected).toBe(true);
    expect(result.candidates[0].locked).toBe(false);
    expect(result.autoSelection).toEqual([{ imageId: result.candidates[0].id, status: "auto_selected" }]);
    const stored = prisma.rows.get(result.candidates[0].id);
    expect(stored?.selected).toBe(true);
    expect(stored?.locked).toBe(false);
  });

  it("generateImageCandidates: 사람이 이 카테고리의 다른 이미지를 명시적으로 고정(locked)해 두었으면 새 후보를 자동 승격하지 않는다 (T1-155)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    prisma.seed({
      id: "pinned-1",
      sourceImageId: "img-1",
      category: "HERO",
      selected: true,
      locked: true,
    });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    expect(result.candidates[0].selected).toBeFalsy();
    expect(result.autoSelection).toEqual([{ imageId: result.candidates[0].id, status: "skipped_locked" }]);
    // 사람이 고정한 이미지는 그대로 selected 상태로 남아 있다.
    expect(prisma.rows.get("pinned-1")?.selected).toBe(true);
  });

  it("generateImageCandidates: 같은 카테고리라도 selected가 아니거나 locked가 아닌 이미지는 자동 승격을 막지 않는다 (T1-155)", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    // 과거에 selected였지만 locked는 아닌(=사람이 다시 확인하지 않은) 이미지 —
    // T1-154가 실제로 발견한 상태(Gemini 시절 선택이 GPT Image 2 전환 후에도
    // 그대로 남아 있던 것)와 동일하다.
    prisma.seed({
      id: "stale-selected-1",
      sourceImageId: "img-1",
      category: "HERO",
      selected: true,
      locked: false,
    });
    seedProfileFor(prisma, "img-1");
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    const result = await service.generateImageCandidates("img-1", "HERO", { count: 1 });

    expect(result.autoSelection).toEqual([{ imageId: result.candidates[0].id, status: "auto_selected" }]);
    expect(result.candidates[0].selected).toBe(true);
  });
});
