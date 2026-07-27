import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockOcrProvider } from "@acos/core";
import type { OcrResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { OCR_PROVIDER } from "./ocr.constants";
import { OcrService } from "./ocr.service";
import { PrismaOcrRunStore } from "./prisma-ocr-run.store";

/** ocr_results 테이블을 흉내 내는 인메모리 Prisma 목업 */
function createPrismaMock() {
  const rows = new Map<string, OcrResult>();
  let sequence = 0;

  const prisma = {
    rows,
    image: {
      findUnique: jest.fn(),
    },
    ocrResult: {
      create: jest.fn(async ({ data }: { data: Partial<OcrResult> }) => {
        const now = new Date();
        const row = {
          id: `ocr-${++sequence}`,
          imageId: data.imageId,
          provider: data.provider,
          status: data.status ?? "PENDING",
          confidence: null,
          extractedText: null,
          rawJson: null,
          error: null,
          attempts: 0,
          startedAt: data.startedAt ?? null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        } as OcrResult;
        rows.set(row.id, row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<OcrResult>;
        }) => {
          const row = rows.get(where.id) as OcrResult;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => ({
          ...(rows.get(where.id) as OcrResult),
        }),
      ),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => [...rows.values()]),
    },
  };
  return prisma;
}

describe("OcrService (Service Test)", () => {
  async function createService(prisma: ReturnType<typeof createPrismaMock>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OcrService,
        PrismaOcrRunStore,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: {
            getObject: jest.fn(async () => Buffer.from("fake-image")),
          },
        },
        { provide: OCR_PROVIDER, useValue: new MockOcrProvider() },
      ],
    }).compile();
    return moduleRef.get(OcrService);
  }

  it("Mock Provider로 OCR을 실행하면 SUCCESS 결과가 저장된다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findUnique.mockResolvedValue({
      id: "img-1",
      key: "images/img.png",
      mimeType: "image/png",
    });
    const service = await createService(prisma);

    const result = await service.runOcr("img-1");

    expect(result.status).toBe("SUCCESS");
    expect(result.provider).toBe("mock");
    expect(result.extractedText).toBe("Magic Clean PVC Mat");
    expect(result.confidence).toBe(0.98);
    expect(result.rawJson).toMatchObject({ provider: "mock" });
    expect(result.startedAt).not.toBeNull();
    expect(result.completedAt).not.toBeNull();
  });

  it("실행할 때마다 새 레코드가 쌓인다 (1:N 이력)", async () => {
    const prisma = createPrismaMock();
    prisma.image.findUnique.mockResolvedValue({
      id: "img-1",
      key: "images/img.png",
      mimeType: "image/png",
    });
    const service = await createService(prisma);

    const first = await service.runOcr("img-1");
    const second = await service.runOcr("img-1");

    expect(first.id).not.toBe(second.id);
    expect(prisma.rows.size).toBe(2);
  });

  it("존재하지 않는 이미지는 404를 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findUnique.mockResolvedValue(null);
    const service = await createService(prisma);

    await expect(service.runOcr("nope")).rejects.toThrow(NotFoundException);
  });

  it("결과가 없으면 조회 시 404를 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.ocrResult.findFirst.mockResolvedValue(null);
    const service = await createService(prisma);

    await expect(service.getLatestByImageId("img-1", false)).rejects.toThrow(
      NotFoundException,
    );
  });
});
