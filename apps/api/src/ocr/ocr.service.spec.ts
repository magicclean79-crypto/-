import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MockOcrProvider } from "@acos/core";
import type { OcrProvider } from "@acos/core";
import type { OcrResult } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
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
          // 비용·단위 (TASK-3001) — 실제 스키마와 같은 모양이어야
          // "비용이 기록되는가"가 구조적으로 검증된다
          cost: null,
          units: 1,
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
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    options: { provider?: OcrProvider; budget?: unknown } = {},
  ) {
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
        {
          provide: OCR_PROVIDER,
          useValue: options.provider ?? new MockOcrProvider(),
        },
        {
          provide: LlmBudgetService,
          useValue: options.budget ?? { assertWithinBudget: jest.fn() },
        },
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

  describe("AI 비용 편입 (TASK-3001, CTO 결정 2901-④)", () => {
    const image = {
      id: "img-1",
      key: "images/img.png",
      mimeType: "image/png",
    };

    /** 가격표에 있는 엔진처럼 행동하는 Provider */
    class FakeGoogleVision implements OcrProvider {
      readonly name = "google-vision";
      async recognize() {
        return { text: "매직클린", confidence: null, raw: {} };
      }
    }

    it("성공한 호출에 비용이 기록된다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findUnique.mockResolvedValue(image);
      const service = await createService(prisma, {
        provider: new FakeGoogleVision(),
      });

      const result = await service.runOcr("img-1");
      expect(result.status).toBe("SUCCESS");
      // 1단위 = $0.0015 (google-vision 공개 단가)
      expect(Number([...prisma.rows.values()][0].cost)).toBe(0.0015);
    });

    it("과금 없는 엔진은 0으로 기록된다 — null(모름)과 다르다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findUnique.mockResolvedValue(image);
      const service = await createService(prisma);

      await service.runOcr("img-1");
      expect(Number([...prisma.rows.values()][0].cost)).toBe(0);
    });

    it("실패한 호출에는 비용을 적지 않는다 — 모르는 것을 숫자로 적지 않는다", async () => {
      class Broken implements OcrProvider {
        readonly name = "google-vision";
        async recognize(): Promise<never> {
          throw new Error("boom");
        }
      }
      const prisma = createPrismaMock();
      prisma.image.findUnique.mockResolvedValue(image);
      const service = await createService(prisma, { provider: new Broken() });

      const result = await service.runOcr("img-1");
      expect(result.status).toBe("FAILED");
      expect([...prisma.rows.values()][0].cost).toBeNull();
    });

    it("예산을 초과하면 호출 전에 막고 실행 기록을 남기지 않는다", async () => {
      // 하지 않은 일을 기록하지 않는다 (LLM 관문과 같은 원칙)
      const prisma = createPrismaMock();
      prisma.image.findUnique.mockResolvedValue(image);
      const service = await createService(prisma, {
        budget: {
          assertWithinBudget: jest.fn(async () => {
            throw new Error("일간 AI 비용 예산을 초과해 OCR 호출을 차단했습니다");
          }),
        },
      });

      await expect(service.runOcr("img-1")).rejects.toThrow(/예산을 초과/);
      expect(prisma.rows.size).toBe(0);
    });

    it("무엇이 막혔는지 예산 관문에 알린다", async () => {
      const assertWithinBudget = jest.fn();
      const prisma = createPrismaMock();
      prisma.image.findUnique.mockResolvedValue(image);
      const service = await createService(prisma, {
        budget: { assertWithinBudget },
      });

      await service.runOcr("img-1");
      // "LLM 예산"이라고만 하면 OCR을 눌렀다 429를 받은 사람이 엉뚱한 곳을 본다
      expect(assertWithinBudget).toHaveBeenCalledWith({ what: "OCR 호출" });
    });
  });
});
