import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import { Level1MultiService } from "./level1-multi.service";
import { GeminiAnalysisError, GeminiAnalysisGenerator } from "./gemini-analysis.client";
import { GeminiPageImageGenerator } from "./gemini-page-image.client";

jest.mock("./gemini-analysis.client", () => {
  const actual = jest.requireActual("./gemini-analysis.client");
  return { ...actual, GeminiAnalysisGenerator: jest.fn() };
});
jest.mock("./gemini-page-image.client", () => {
  const actual = jest.requireActual("./gemini-page-image.client");
  return { ...actual, GeminiPageImageGenerator: jest.fn() };
});

function makePrismaMock() {
  const generations = new Map<string, Record<string, unknown>>();
  const pages: Record<string, unknown>[] = [];
  let genSeq = 0;
  let pageSeq = 0;
  return {
    level1Product: { findUnique: jest.fn() },
    level1Asset: { findMany: jest.fn() },
    level1MultiGeneration: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        genSeq += 1;
        const record = {
          id: `gen-${genSeq}`,
          status: "PENDING",
          analysisProvider: null,
          analysisModel: null,
          analysisPromptText: null,
          analysisRawText: null,
          verifiedProductFacts: null,
          analysisAssetIds: [],
          actualProductAssetIds: [],
          errorMessage: null,
          createdAt: new Date("2026-08-23T00:00:00.000Z"),
          updatedAt: new Date("2026-08-23T00:00:00.000Z"),
          pages: [],
          ...data,
        };
        generations.set(record.id, record);
        return record;
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = generations.get(where.id) ?? {};
        const updated = { ...existing, ...data };
        generations.set(where.id, updated);
        return updated;
      }),
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const record = generations.get(where.id);
        if (!record) return null;
        return { ...record, pages: pages.filter((p) => p.generationId === where.id) };
      }),
    },
    level1DetailPage: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        pageSeq += 1;
        const record = {
          id: `page-${pageSeq}`,
          createdAt: new Date("2026-08-23T00:00:00.000Z"),
          updatedAt: new Date("2026-08-23T00:00:00.000Z"),
          ...data,
        };
        pages.push(record);
        return record;
      }),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        pages.find((p) => p.id === where.id) ?? null,
      ),
    },
    __debug: { generations, pages },
  };
}

function makeStorageMock() {
  return {
    getObject: jest.fn().mockResolvedValue(Buffer.from("fake-image-bytes")),
    putObject: jest.fn().mockResolvedValue("http://minio/level1-multi/x.png"),
  };
}

async function flushMicrotasks(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("Level1MultiService", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("제품이 없으면 NotFoundException을 던진다", async () => {
    const prisma = makePrismaMock();
    prisma.level1Product.findUnique.mockResolvedValue(null);
    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      makeStorageMock() as unknown as StorageService,
    );

    await expect(service.startGeneration("missing-product")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("업로드된 사진이 없으면 BadRequestException을 던진다", async () => {
    const prisma = makePrismaMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([]);
    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      makeStorageMock() as unknown as StorageService,
    );

    await expect(service.startGeneration("p1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("분석 1회 + 페이지 이미지 N회 호출로 SUCCEEDED까지 진행한다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "UNKNOWN" },
      { id: "a2", objectKey: "level1/p1/a2.jpg", mimeType: "image/jpeg", role: "UNKNOWN" },
    ]);

    const analyzeMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash",
      rawText: "{}",
      result: {
        verifiedProductFacts: {
          name: "베란다용 스텐 호스 세트 3M",
          brand: "삼정크린마스터(주)",
          model: null,
          manufacturer: null,
          originCountry: "대한민국",
          materials: ["ABS", "PVC", "스테인리스"],
          dimensions: "3M",
          includedComponents: ["분사기", "호스", "고무패킹 2개"],
          specs: {},
          cautions: [],
        },
        assetRoles: [
          { assetIndex: 0, role: "ACTUAL_PRODUCT" },
          { assetIndex: 1, role: "PACKAGING" },
        ],
        pagePlan: [
          { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "제품 전체 샷" },
          { pageIndex: 2, pageRole: "FEATURES", title: "특징", designBrief: "구성품 클로즈업" },
          { pageIndex: 3, pageRole: "USE", title: "사용법", designBrief: "사용 장면" },
          { pageIndex: 4, pageRole: "COMPONENTS", title: "구성품", designBrief: "구성품 펼침" },
        ],
      },
    });
    (GeminiAnalysisGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash",
      analyze: analyzeMock,
    }));

    const generateMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash-image",
      imageBase64: Buffer.from("page-image").toString("base64"),
      mimeType: "image/png",
    });
    (GeminiPageImageGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
    const started = await service.startGeneration("p1");
    expect(started.status).toBe("ANALYZING");

    await flushMicrotasks(50);

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(4);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("SUCCEEDED");
    expect(final.verifiedProductFacts?.name).toBe("베란다용 스텐 호스 세트 3M");
    expect(final.pages).toHaveLength(4);
    expect(final.pages.every((p) => p.status === "SUCCEEDED")).toBe(true);
    // 필수 4종 역할이 모두 채워졌는지 확인 (T1-195).
    expect(final.pages.map((p) => p.pageRole)).toEqual(["HERO", "FEATURES", "USE", "COMPONENTS"]);
    // 실제 제품 사진(a1)만 reference로 쓰이고, PACKAGING(a2)은 제외된다.
    expect(final.pages[0].referenceAssetIds).toEqual(["a1"]);
    // 근거(provenance) — 분석에 실제로 넘긴 asset 전체가 기록된다.
    expect(final.productFactsProvenance?.analyzedAssetIds).toEqual(["a1", "a2"]);
    expect(final.productFactsProvenance?.actualProductAssetIds).toEqual(["a1"]);

    // 형태 reference로는 실제 제품 사진 1장만 전달됐는지 확인.
    const [, images] = generateMock.mock.calls[0];
    expect(images).toHaveLength(1);
  });

  it("필수 역할이 일부 빠진 분석 결과에는 보수적 기본 페이지를 추가해 최소 구조를 채운다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "ACTUAL_PRODUCT" },
    ]);

    const analyzeMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash",
      rawText: "{}",
      result: {
        verifiedProductFacts: {
          name: null,
          brand: null,
          model: null,
          manufacturer: null,
          originCountry: null,
          materials: [],
          dimensions: null,
          includedComponents: [],
          specs: {},
          cautions: [],
        },
        assetRoles: [{ assetIndex: 0, role: "ACTUAL_PRODUCT" }],
        // HERO만 있고 FEATURES/USE/COMPONENTS는 빠져 있다.
        pagePlan: [{ pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x" }],
      },
    });
    (GeminiAnalysisGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash",
      analyze: analyzeMock,
    }));
    const generateMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash-image",
      imageBase64: Buffer.from("page-image").toString("base64"),
      mimeType: "image/png",
    });
    (GeminiPageImageGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
    const started = await service.startGeneration("p1");
    await flushMicrotasks(50);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("SUCCEEDED");
    expect(final.pages.map((p) => p.pageRole)).toEqual(["HERO", "FEATURES", "USE", "COMPONENTS"]);
  });

  it("실제 제품 사진으로 분류된 이미지가 없으면 FAILED로 기록하고 이미지 생성 호출을 하지 않는다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "UNKNOWN" },
    ]);

    const analyzeMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash",
      rawText: "{}",
      result: {
        verifiedProductFacts: {
          name: null,
          brand: null,
          model: null,
          manufacturer: null,
          originCountry: null,
          materials: [],
          dimensions: null,
          includedComponents: [],
          specs: {},
          cautions: [],
        },
        assetRoles: [{ assetIndex: 0, role: "PACKAGING" }],
        pagePlan: [
          { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x" },
          { pageIndex: 2, pageRole: "SPEC", title: "스펙", designBrief: "y" },
          { pageIndex: 3, pageRole: "DETAIL", title: "디테일", designBrief: "z" },
        ],
      },
    });
    (GeminiAnalysisGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash",
      analyze: analyzeMock,
    }));
    const generateMock = jest.fn();
    (GeminiPageImageGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
    const started = await service.startGeneration("p1");
    await flushMicrotasks(50);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("FAILED");
    expect(final.errorMessage).toContain("실제 제품 사진");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("분석 호출이 실패하면 FAILED로 기록하고 예외를 던지지 않는다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "UNKNOWN" },
    ]);
    const analyzeMock = jest.fn().mockRejectedValue(new GeminiAnalysisError("정책상 거부됨", "SAFETY"));
    (GeminiAnalysisGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash",
      analyze: analyzeMock,
    }));

    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
    const started = await service.startGeneration("p1");
    await flushMicrotasks(50);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("FAILED");
    expect(final.errorMessage).toContain("정책상 거부됨");
  });

  it("일부 페이지만 실패하면 PARTIAL로 기록한다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "ACTUAL_PRODUCT" },
    ]);
    const analyzeMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash",
      rawText: "{}",
      result: {
        verifiedProductFacts: {
          name: null,
          brand: null,
          model: null,
          manufacturer: null,
          originCountry: null,
          materials: [],
          dimensions: null,
          includedComponents: [],
          specs: {},
          cautions: [],
        },
        assetRoles: [{ assetIndex: 0, role: "ACTUAL_PRODUCT" }],
        pagePlan: [
          { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x" },
          { pageIndex: 2, pageRole: "FEATURES", title: "특징", designBrief: "y" },
          { pageIndex: 3, pageRole: "USE", title: "사용", designBrief: "z" },
          { pageIndex: 4, pageRole: "COMPONENTS", title: "구성품", designBrief: "w" },
        ],
      },
    });
    (GeminiAnalysisGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash",
      analyze: analyzeMock,
    }));
    const generateMock = jest
      .fn()
      .mockResolvedValueOnce({ model: "m", imageBase64: Buffer.from("i").toString("base64"), mimeType: "image/png" })
      .mockRejectedValueOnce(new Error("일시적 오류"))
      .mockResolvedValueOnce({ model: "m", imageBase64: Buffer.from("i").toString("base64"), mimeType: "image/png" })
      .mockResolvedValueOnce({ model: "m", imageBase64: Buffer.from("i").toString("base64"), mimeType: "image/png" });
    (GeminiPageImageGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
    const started = await service.startGeneration("p1");
    await flushMicrotasks(50);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("PARTIAL");
    expect(final.pages.filter((p) => p.status === "SUCCEEDED")).toHaveLength(3);
    expect(final.pages.filter((p) => p.status === "FAILED")).toHaveLength(1);
  });
});
