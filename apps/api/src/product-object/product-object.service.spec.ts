import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createDefaultPromptEngine,
  LlmVisionProvider,
  MockLlmProvider,
  type VisionProvider,
} from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { ProductObjectService } from "./product-object.service";
import {
  createPrismaMock,
  projectWithOcr,
} from "./product-object.spec-helpers";
import { VISION_PROVIDER } from "./vision.constants";

/** 공식 Vision 엔진(LLM 기반)을 mock LLM으로 구성 — 운영 기본 구성과 동일한 경로 */
function createTestVisionProvider(): LlmVisionProvider {
  const llm = new MockLlmProvider();
  return new LlmVisionProvider({
    promptEngine: createDefaultPromptEngine(),
    llmProviderName: llm.name,
    complete: async (request) => {
      const result = await llm.complete(request);
      return { provider: result.provider, model: result.model, text: result.text };
    },
    loadCompanyBrain: async () => ({
      knowledge: [],
      decisions: [],
      memories: [],
    }),
  });
}

describe("ProductObjectService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    vision: VisionProvider = createTestVisionProvider(),
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductObjectService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { getObject: jest.fn(async () => Buffer.from("img")) },
        },
        { provide: VISION_PROVIDER, useValue: vision },
      ],
    }).compile();
    return moduleRef.get(ProductObjectService);
  }

  it("OCR + Vision(LLM 기반 공식 엔진)을 조립해 v1 Product Object를 생성한다", async () => {
    const prisma = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue(projectWithOcr);
    const service = await createService(prisma);

    const result = await service.buildAndCreate("proj-1");

    expect(result.version).toBe(1);
    expect(result.status).toBe("DRAFT");
    // mock LLM 초안 기준 vision.suggestedTitle = OCR 첫 줄
    expect(result.title).toBe("Magic Clean PVC Mat");
    expect(result.category).toBe("미분류");
    expect(result.ocrSummary?.sources).toHaveLength(1);
    expect(result.ocrSummary?.averageConfidence).toBe(0.94);
    expect(result.visionSummary?.source).toBe("llm:mock");
    expect(result.metadata?.imageCount).toBe(2);
  });

  it("재생성하면 버전이 증가한다 (1:N 이력)", async () => {
    const prisma = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue(projectWithOcr);
    const service = await createService(prisma);

    const first = await service.buildAndCreate("proj-1");
    const second = await service.buildAndCreate("proj-1");

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(prisma.rows.size).toBe(2);
  });

  it("최신 버전을 조회하고 ?version으로 과거 버전도 조회한다", async () => {
    const prisma = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue(projectWithOcr);
    const service = await createService(prisma);
    await service.buildAndCreate("proj-1");
    await service.buildAndCreate("proj-1");

    expect((await service.getByProjectId("proj-1")).version).toBe(2);
    expect((await service.getByProjectId("proj-1", 1)).version).toBe(1);
    await expect(service.getByProjectId("proj-1", 9)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("Vision Provider가 계속 실패해도 조립은 성공한다 (visionSummary null)", async () => {
    const prisma = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue(projectWithOcr);
    const failing: VisionProvider = {
      name: "failing",
      analyze: jest.fn(async () => {
        throw new Error("vision 오류");
      }),
    };
    const service = await createService(prisma, failing);

    const result = await service.buildAndCreate("proj-1");

    expect(result.status).toBe("DRAFT");
    expect(result.visionSummary).toBeNull();
    // Vision이 없으면 제목은 OCR 첫 줄로 폴백된다
    expect(result.title).toBe("Magic Clean PVC Mat");
    expect(failing.analyze).toHaveBeenCalledTimes(3); // 재시도 포함
  });

  it("존재하지 않는 프로젝트는 404를 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue(null);
    const service = await createService(prisma);

    await expect(service.buildAndCreate("nope")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("Product Object가 없으면 조회 시 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const service = await createService(prisma);

    await expect(service.getByProjectId("proj-1")).rejects.toThrow(
      NotFoundException,
    );
  });

  describe("상태 전이 (TASK-0302)", () => {
    async function setup() {
      const prisma = createPrismaMock();
      prisma.project.findUnique.mockResolvedValue(projectWithOcr);
      const service = await createService(prisma);
      await service.buildAndCreate("proj-1"); // v1 DRAFT (OCR+Vision 요약 보유)
      return service;
    }

    it("DRAFT → READY 전환 (검증 통과)", async () => {
      const service = await setup();
      const result = await service.updateStatus("proj-1", 1, "READY");
      expect(result.status).toBe("READY");
    });

    it("READY → DRAFT 되돌리기, READY → ARCHIVED 종결", async () => {
      const service = await setup();
      await service.updateStatus("proj-1", 1, "READY");
      expect((await service.updateStatus("proj-1", 1, "DRAFT")).status).toBe(
        "DRAFT",
      );
      await service.updateStatus("proj-1", 1, "READY");
      expect(
        (await service.updateStatus("proj-1", 1, "ARCHIVED")).status,
      ).toBe("ARCHIVED");
    });

    it("ARCHIVED에서는 어떤 전이도 불가 (400)", async () => {
      const service = await setup();
      await service.updateStatus("proj-1", 1, "ARCHIVED");
      await expect(
        service.updateStatus("proj-1", 1, "DRAFT"),
      ).rejects.toThrow(BadRequestException);
    });

    it("유효하지 않은 상태 값은 400", async () => {
      const service = await setup();
      await expect(
        service.updateStatus("proj-1", 1, "PUBLISHED"),
      ).rejects.toThrow(BadRequestException);
    });

    it("없는 버전은 404", async () => {
      const service = await setup();
      await expect(
        service.updateStatus("proj-1", 9, "READY"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
