import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockOcrProvider } from "@acos/core";
import request from "supertest";
import type { OcrResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { OCR_PROVIDER } from "./ocr.constants";
import { OcrController } from "./ocr.controller";
import { OcrService } from "./ocr.service";
import { PrismaOcrRunStore } from "./prisma-ocr-run.store";

describe("OCR API (API Test)", () => {
  let app: INestApplication;
  const rows = new Map<string, OcrResult>();
  let sequence = 0;

  const prismaMock = {
    image: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "img-1"
          ? { id: "img-1", key: "images/img.png", mimeType: "image/png" }
          : null,
      ),
    },
    ocrResult: {
      create: jest.fn(async ({ data }: { data: Partial<OcrResult> }) => {
        const now = new Date();
        const row = {
          id: `ocr-${++sequence}`,
          confidence: null,
          extractedText: null,
          rawJson: null,
          error: null,
          attempts: 0,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
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
      findFirst: jest.fn(async ({ where }: { where: { imageId: string } }) => {
        const matches = [...rows.values()]
          .filter((row) => row.imageId === where.imageId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matches[0] ? { ...matches[0] } : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: { imageId?: string } }) =>
        [...rows.values()].filter(
          (row) => !where?.imageId || row.imageId === where.imageId,
        ),
      ),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OcrController],
      providers: [
        OcrService,
        PrismaOcrRunStore,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: StorageService,
          useValue: {
            getObject: jest.fn(async () => Buffer.from("fake-image")),
          },
        },
        { provide: OCR_PROVIDER, useValue: new MockOcrProvider() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /images/:imageId/ocr — Mock JSON을 반환한다", async () => {
    const response = await request(app.getHttpServer())
      .post("/images/img-1/ocr")
      .expect(201);

    expect(response.body).toMatchObject({
      imageId: "img-1",
      provider: "mock",
      status: "SUCCESS",
      extractedText: "Magic Clean PVC Mat",
      confidence: 0.98,
    });
    expect(response.body.rawJson).toMatchObject({
      text: "Magic Clean PVC Mat",
      confidence: 0.98,
      provider: "mock",
    });
  });

  it("GET /images/:imageId/ocr — 최신 결과를 반환한다", async () => {
    const response = await request(app.getHttpServer())
      .get("/images/img-1/ocr")
      .expect(200);

    expect(response.body.status).toBe("SUCCESS");
    expect(response.body.extractedText).toBe("Magic Clean PVC Mat");
    expect(response.body.rawJson).toBeUndefined();
  });

  it("GET /images/:imageId/ocr/history — 실행 이력을 반환한다", async () => {
    await request(app.getHttpServer()).post("/images/img-1/ocr").expect(201);

    const response = await request(app.getHttpServer())
      .get("/images/img-1/ocr/history")
      .expect(200);

    expect(response.body.results.length).toBeGreaterThanOrEqual(2);
  });

  it("POST /images/:imageId/ocr — 없는 이미지는 404", async () => {
    await request(app.getHttpServer()).post("/images/nope/ocr").expect(404);
  });
});
