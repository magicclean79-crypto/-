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
      ...row,
    } as ImageRecord);
  };
  const seedProductProfile = (input: {
    id: string;
    imageIds: string[];
    profile: unknown;
    ocrText?: string | null;
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
          where: { sourceImageId?: string; kind?: string; category?: string };
          orderBy?: { createdAt?: string; groupVersion?: string };
        }) => {
          const matches = [...rows.values()].filter(
            (row) =>
              (where.sourceImageId === undefined || row.sourceImageId === where.sourceImageId) &&
              (where.kind === undefined || row.kind === where.kind) &&
              (where.category === undefined || row.category === where.category),
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
            id?: { not?: string };
            photoType?: string;
          };
          take?: number;
        }) => {
          const matches = [...rows.values()].filter(
            (row) =>
              (where.projectId === undefined || row.projectId === where.projectId) &&
              (where.kind === undefined || row.kind === where.kind) &&
              (where.id?.not === undefined || row.id !== where.id.not) &&
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

  it("selectImage: 카테고리가 없는 이미지는 선택할 수 없다", async () => {
    const prisma = createPrismaMock();
    prisma.seed({ id: "img-1" });
    const edit = jest.fn<Promise<ImageEditResult>, [ImageEditRequest]>(async () => fakeResult);
    const service = await createService(prisma, edit);

    await expect(service.selectImage("img-1")).rejects.toThrow(BadRequestException);
  });
});
