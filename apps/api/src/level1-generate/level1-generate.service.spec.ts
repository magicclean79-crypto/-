import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import { Level1GenerateService } from "./level1-generate.service";
import { GeminiOneShotError, GeminiOneShotGenerator } from "./gemini-one-shot.client";

jest.mock("./gemini-one-shot.client", () => {
  const actual = jest.requireActual("./gemini-one-shot.client");
  return { ...actual, GeminiOneShotGenerator: jest.fn() };
});

function makePrismaMock() {
  return {
    level1Product: { findUnique: jest.fn() },
    level1Asset: { findMany: jest.fn() },
    level1Generation: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  };
}

function makeStorageMock() {
  return {
    getObject: jest.fn().mockResolvedValue(Buffer.from("fake-image-bytes")),
    putObject: jest.fn().mockResolvedValue("http://minio/level1-generate/x.png"),
  };
}

describe("Level1GenerateService", () => {
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
    const service = new Level1GenerateService(prisma as unknown as PrismaService, makeStorageMock() as unknown as StorageService);

    await expect(service.generate("missing-product")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("업로드된 사진이 없으면 BadRequestException을 던진다", async () => {
    const prisma = makePrismaMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([]);
    const service = new Level1GenerateService(prisma as unknown as PrismaService, makeStorageMock() as unknown as StorageService);

    await expect(service.generate("p1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("단일 Gemini generateContent 호출로 이미지를 생성하고 SUCCEEDED로 저장한다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "ACTUAL_PRODUCT" },
      { id: "a2", objectKey: "level1/p1/a2.jpg", mimeType: "image/jpeg", role: "PACKAGING" },
    ]);
    prisma.level1Generation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "g1",
      createdAt: new Date("2026-08-23T00:00:00.000Z"),
      updatedAt: new Date("2026-08-23T00:00:00.000Z"),
      ...data,
    }));

    const generateMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash-image",
      imageBase64: Buffer.from("generated-image").toString("base64"),
      mimeType: "image/png",
      text: null,
    });
    (GeminiOneShotGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1GenerateService(prisma as unknown as PrismaService, storage as unknown as StorageService);
    const result = await service.generate("p1");

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.provider).toBe("gemini");
    expect(result.referenceAssetIds).toEqual(["a1", "a2"]);
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(prisma.level1Generation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }),
    );
  });

  it("Gemini 호출이 실패하면 FAILED로 기록하고 원인을 담아 반환한다(예외를 던지지 않음)", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "a1", objectKey: "level1/p1/a1.jpg", mimeType: "image/jpeg", role: "ACTUAL_PRODUCT" },
    ]);
    prisma.level1Generation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "g2",
      createdAt: new Date("2026-08-23T00:00:00.000Z"),
      updatedAt: new Date("2026-08-23T00:00:00.000Z"),
      ...data,
    }));

    const generateMock = jest
      .fn()
      .mockRejectedValue(new GeminiOneShotError("정책상 거부됨", "SAFETY"));
    (GeminiOneShotGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1GenerateService(prisma as unknown as PrismaService, storage as unknown as StorageService);
    const result = await service.generate("p1");

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("정책상 거부됨");
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("실제 제품 사진(ACTUAL_PRODUCT)을 항상 먼저 정렬해 reference로 전달한다", async () => {
    const prisma = makePrismaMock();
    const storage = makeStorageMock();
    prisma.level1Product.findUnique.mockResolvedValue({ id: "p1" });
    prisma.level1Asset.findMany.mockResolvedValue([
      { id: "packaging-1", objectKey: "k1", mimeType: "image/jpeg", role: "PACKAGING" },
      { id: "actual-1", objectKey: "k2", mimeType: "image/jpeg", role: "ACTUAL_PRODUCT" },
    ]);
    prisma.level1Generation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "g3",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }));
    const generateMock = jest.fn().mockResolvedValue({
      model: "gemini-2.5-flash-image",
      imageBase64: Buffer.from("img").toString("base64"),
      mimeType: "image/png",
      text: null,
    });
    (GeminiOneShotGenerator as jest.Mock).mockImplementation(() => ({
      model: "gemini-2.5-flash-image",
      generate: generateMock,
    }));

    const service = new Level1GenerateService(prisma as unknown as PrismaService, storage as unknown as StorageService);
    const result = await service.generate("p1");

    expect(result.referenceAssetIds).toEqual(["actual-1", "packaging-1"]);
    const [, images] = generateMock.mock.calls[0];
    expect(images).toHaveLength(2);
  });
});
