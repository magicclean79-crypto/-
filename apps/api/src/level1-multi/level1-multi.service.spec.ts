import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import { Level1MultiService } from "./level1-multi.service";
import { GeminiAnalysisError, GeminiAnalysisGenerator } from "./gemini-analysis.client";
import { GeminiPageImageGenerator } from "./gemini-page-image.client";
import type { Level1AssetOcrService } from "./level1-asset-ocr.service";

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
    // T1-196 — getGeneration()이 OCR 요약을 조회할 때 쓴다. 이 테스트
    // 스위트는 OCR provider 자체(Level1AssetOcrService)를 mock으로 대체해
    // 실제 OCR 레코드를 만들지 않으므로 항상 빈 목록을 돌려준다.
    level1AssetOcrResult: {
      findMany: jest.fn().mockResolvedValue([]),
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

/**
 * Level1AssetOcrService mock (T1-196) — 이 스위트는 Gemini 분석/이미지
 * 생성 파이프라인 배선을 검증하는 것이 목적이라 OCR 자체는 항상 "결과
 * 없음"으로 대체한다. OCR 텍스트 추출·교차 검증 로직은
 * ocr-facts-extraction.spec.ts·facts-verification.spec.ts·
 * level1-asset-ocr.service.spec.ts가 별도로 검증한다.
 */
function makeOcrServiceMock() {
  return { runForAssets: jest.fn().mockResolvedValue([]) };
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
      makeOcrServiceMock() as unknown as Level1AssetOcrService,
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
      makeOcrServiceMock() as unknown as Level1AssetOcrService,
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
          {
            pageIndex: 1,
            pageRole: "HERO",
            title: "대표",
            designBrief: "제품 전체 샷",
            sectionDescription: "제품 전체 모습을 보여주는 대표 이미지입니다.",
          },
          {
            pageIndex: 2,
            pageRole: "FEATURES",
            title: "특징",
            designBrief: "구성품 클로즈업",
            sectionDescription: "스테인리스 호스와 분사기의 디테일을 보여줍니다.",
          },
          {
            pageIndex: 3,
            pageRole: "USE",
            title: "사용법",
            designBrief: "사용 장면",
            sectionDescription: "베란다에서 이 제품을 사용하는 장면입니다.",
          },
          {
            pageIndex: 4,
            pageRole: "COMPONENTS",
            title: "구성품",
            designBrief: "구성품 펼침",
            sectionDescription: "분사기·호스·고무패킹 구성품을 펼쳐 보여줍니다.",
          },
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

    const ocrService = makeOcrServiceMock();
    ocrService.runForAssets.mockResolvedValue([
      { assetId: "a1", status: "SUCCESS", text: "", confidence: null, error: null },
      {
        assetId: "a2",
        status: "SUCCESS",
        text: "제조 및 판매원 삼정크린마스터(주)\n원산지 대한민국",
        confidence: 0.9,
        error: null,
      },
    ]);
    // getGeneration()의 ocrResults는 DB(level1AssetOcrResult)를 다시 읽는다 —
    // 이 테스트는 OCR 서비스 자체를 mock으로 대체했으므로(store를 거치지
    // 않는다), 실제 store가 남겼을 레코드를 여기서 대신 seed한다.
    prisma.level1AssetOcrResult.findMany.mockResolvedValue([
      {
        assetId: "a1",
        provider: "mock",
        status: "SUCCESS",
        extractedText: "",
        confidence: null,
        boundingBoxes: null,
        error: null,
        createdAt: new Date("2026-08-23T00:00:01.000Z"),
      },
      {
        assetId: "a2",
        provider: "mock",
        status: "SUCCESS",
        extractedText: "제조 및 판매원 삼정크린마스터(주)\n원산지 대한민국",
        confidence: 0.9,
        boundingBoxes: [{ text: "삼정크린마스터(주)", vertices: [] }],
        error: null,
        createdAt: new Date("2026-08-23T00:00:01.000Z"),
      },
    ]);
    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      ocrService as unknown as Level1AssetOcrService,
    );
    const started = await service.startGeneration("p1");
    expect(started.status).toBe("ANALYZING");

    await flushMicrotasks(50);

    expect(ocrService.runForAssets).toHaveBeenCalledTimes(1);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(4);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("SUCCEEDED");
    expect(final.verifiedProductFacts?.name).toBe("베란다용 스텐 호스 세트 3M");
    expect(final.pages).toHaveLength(4);
    expect(final.pages.every((p) => p.status === "SUCCEEDED")).toBe(true);
    // 필수 4종 역할이 모두 채워졌는지 확인 (T1-195).
    expect(final.pages.map((p) => p.pageRole)).toEqual(["HERO", "FEATURES", "USE", "COMPONENTS"]);
    // 섹션 설명이 그대로 저장되고, 근거 사진(referenceAssetIds ∪ OCR한 사진)에 a1·a2가 모두 포함된다(T1-196).
    expect(final.pages[0].sectionDescription).toBe("제품 전체 모습을 보여주는 대표 이미지입니다.");
    expect(final.pages[0].evidenceAssetIds.sort()).toEqual(["a1", "a2"]);
    // AI가 sectionDescription을 직접 냈고 필드 conflict가 없으므로 신뢰도는 최고값(0.9)이다.
    expect(final.pages[0].descriptionConfidence).toBe(0.9);
    // OCR 결과가 원문 그대로(요약 없이) 노출된다.
    expect(final.ocrResults).toHaveLength(2);
    expect(final.ocrResults.find((r) => r.assetId === "a2")?.extractedText).toContain("삼정크린마스터(주)");
    expect(final.ocrResults.find((r) => r.assetId === "a2")?.boundingBoxCount).toBe(1);
    // brand는 vision-analysis 단일 출처라 single-source다(OCR은 manufacturer만 뽑았다).
    expect(final.factsVerification.find((f) => f.field === "brand")?.status).toBe("single-source");
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
      makeOcrServiceMock() as unknown as Level1AssetOcrService,
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
      makeOcrServiceMock() as unknown as Level1AssetOcrService,
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
      makeOcrServiceMock() as unknown as Level1AssetOcrService,
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
      makeOcrServiceMock() as unknown as Level1AssetOcrService,
    );
    const started = await service.startGeneration("p1");
    await flushMicrotasks(50);

    const final = await service.getGeneration(started.id);
    expect(final.status).toBe("PARTIAL");
    expect(final.pages.filter((p) => p.status === "SUCCEEDED")).toHaveLength(3);
    expect(final.pages.filter((p) => p.status === "FAILED")).toHaveLength(1);
  });

  it("OCR 원문과 Gemini Vision 분석의 제조사 표기가 다르면 자동으로 고르지 않고 conflict로 기록한다(T1-196)", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "ACTUAL_PRODUCT" },
      { id: "a2", objectKey: "level1/p1/a2.jpg", mimeType: "image/jpeg", role: "PACKAGING" },
    ]);

    const analyzeMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash",
      rawText: "{}",
      result: {
        verifiedProductFacts: {
          name: "베란다용 스텐 호스 세트 3M",
          brand: null,
          model: null,
          manufacturer: "상성산업(주)", // Gemini Vision이 읽은 값 — T1-195와 동일 증상 재현
          originCountry: null,
          materials: [],
          dimensions: null,
          includedComponents: [],
          specs: {},
          cautions: [],
        },
        assetRoles: [
          { assetIndex: 0, role: "ACTUAL_PRODUCT" },
          { assetIndex: 1, role: "PACKAGING" },
        ],
        pagePlan: [
          { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x", sectionDescription: "대표 이미지입니다." },
          { pageIndex: 2, pageRole: "FEATURES", title: "특징", designBrief: "y", sectionDescription: "특징입니다." },
          { pageIndex: 3, pageRole: "USE", title: "사용", designBrief: "z", sectionDescription: "사용 장면입니다." },
          { pageIndex: 4, pageRole: "COMPONENTS", title: "구성품", designBrief: "w", sectionDescription: "구성품입니다." },
        ],
      },
    });
    (GeminiAnalysisGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash",
      analyze: analyzeMock,
    }));
    (GeminiPageImageGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: jest
        .fn()
        .mockResolvedValue({ model: "m", imageBase64: Buffer.from("i").toString("base64"), mimeType: "image/png" }),
    }));

    const ocrService = makeOcrServiceMock();
    ocrService.runForAssets.mockResolvedValue([
      { assetId: "a1", status: "SUCCESS", text: "", confidence: null, error: null },
      {
        assetId: "a2",
        status: "SUCCESS",
        // 포장지 OCR 원문 — T1-194가 실제로 읽은 값과 같은 표기
        text: "베란다용 스텐 호스 세트 3M\n제조 및 판매원 상부산업(주)",
        confidence: 0.88,
        error: null,
      },
    ]);

    const service = new Level1MultiService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      ocrService as unknown as Level1AssetOcrService,
    );
    const started = await service.startGeneration("p1");
    await flushMicrotasks(50);

    const final = await service.getGeneration(started.id);
    const manufacturer = final.factsVerification.find((f) => f.field === "manufacturer");
    expect(manufacturer?.status).toBe("conflict");
    expect(manufacturer?.resolvedValue).toBeNull();
    expect(manufacturer?.observations).toEqual(
      expect.arrayContaining([
        { source: "vision-analysis", value: "상성산업(주)" },
        { source: "ocr:a2", value: "상부산업(주)" },
      ]),
    );
    // 미해결 conflict가 있으므로 sectionDescription 신뢰도가 낮아진다(AI 제공 0.9 - 0.2 = 0.7).
    expect(final.pages[0].descriptionConfidence).toBe(0.7);
  });
});
