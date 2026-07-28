import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDefaultPromptEngine, MockLlmProvider } from "@acos/core";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { ContentGenerationService } from "./content-generation.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsService } from "./contents.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";
import { EngineContentGenerator } from "./engine-content.generator";

/** 공식 엔진을 mock LLM + 빈 Company Brain으로 구성 — 운영 기본 구성과 동일한 경로 */
function createEngine(
  prisma: ReturnType<typeof createPrismaMock>,
): ContentGenerationService {
  const companyBrain = {
    query: jest.fn(async () => ({ query: "", results: [] })),
  } as unknown as CompanyBrainService;
  return new ContentGenerationService(
    prisma as unknown as PrismaService,
    companyBrain,
    new LlmService(new MockLlmProvider()),
    createDefaultPromptEngine(),
  );
}

describe("ContentsService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    engine: ContentGenerationService = createEngine(prisma),
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentsService,
        { provide: PrismaService, useValue: prisma },
        {
          // TASK-0506: 구 Generator 경로는 Wrapper를 통해 공식 엔진 호출
          provide: CONTENT_GENERATOR,
          useValue: new EngineContentGenerator(engine),
        },
      ],
    }).compile();
    return moduleRef.get(ContentsService);
  }

  it("최신 READY Product Object로 상세페이지를 생성한다 (내부는 공식 엔진)", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const service = await createService(prisma);

    const content = await service.generate("proj-1", {});

    expect(content.status).toBe("DRAFT");
    expect(content.productObjectVersion).toBe(2);
    // mock LLM 응답에는 Markdown 제목이 없어 fallback 제목이 쓰인다
    expect(content.title).toBe("Magic Clean PVC Mat 상세페이지");
    expect(content.body).toContain("[mock-llm]");
  });

  it("구 경로와 공식 경로(engine)는 같은 PO에 대해 같은 본문을 생성한다 (통합 검증)", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const engine = createEngine(prisma);
    const service = await createService(prisma, engine);

    const legacy = await service.generate("proj-1", {});
    const official = await engine.generate("proj-1", {});

    expect(legacy.body).toBe(official.body);
    expect(legacy.title).toBe(official.title);
  });

  it("READY Product Object가 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({
      ...readyProductObject,
      status: "DRAFT",
    });
    const service = await createService(prisma);

    await expect(service.generate("proj-1", {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it("버전 지정: READY가 아니면 400, 없으면 404", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push(
      { ...readyProductObject, version: 1, status: "DRAFT", id: "po-d" },
      { ...readyProductObject },
    );
    const service = await createService(prisma);

    const content = await service.generate("proj-1", {
      productObjectVersion: 2,
    });
    expect(content.productObjectVersion).toBe(2);

    await expect(
      service.generate("proj-1", { productObjectVersion: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.generate("proj-1", { productObjectVersion: 9 }),
    ).rejects.toThrow(NotFoundException);
  });

  describe("발행 파이프라인 (TASK-0703)", () => {
    async function setup() {
      const prisma = createPrismaMock();
      prisma.productObjects.push({ ...readyProductObject });
      const service = await createService(prisma);
      const content = await service.generate("proj-1", {});
      return { prisma, service, content };
    }

    it("DRAFT → REVIEW → PUBLISHED(발행 시각 기록) → ARCHIVED", async () => {
      const { service, content } = await setup();

      const review = await service.updateStatus("proj-1", content.id, "REVIEW");
      expect(review.status).toBe("REVIEW");
      expect(review.publishedAt).toBeNull();

      const published = await service.updateStatus(
        "proj-1",
        content.id,
        "PUBLISHED",
      );
      expect(published.status).toBe("PUBLISHED");
      expect(published.publishedAt).not.toBeNull();

      const archived = await service.updateStatus(
        "proj-1",
        content.id,
        "ARCHIVED",
      );
      expect(archived.status).toBe("ARCHIVED");
      expect(archived.publishedAt).toBe(published.publishedAt); // 발행 이력 보존
    });

    it("REVIEW → DRAFT 되돌리기를 허용한다", async () => {
      const { service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "REVIEW");
      const back = await service.updateStatus("proj-1", content.id, "DRAFT");
      expect(back.status).toBe("DRAFT");
    });

    it("DRAFT → PUBLISHED 건너뛰기·ARCHIVED 이후 전이는 400", async () => {
      const { service, content } = await setup();
      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow(BadRequestException);

      await service.updateStatus("proj-1", content.id, "ARCHIVED");
      await expect(
        service.updateStatus("proj-1", content.id, "DRAFT"),
      ).rejects.toThrow(BadRequestException);
    });

    it("본문이 비어 있으면 발행(400) — isPublishable 검증", async () => {
      const { prisma, service, content } = await setup();
      await service.updateStatus("proj-1", content.id, "REVIEW");
      const row = prisma.contents.get(content.id);
      if (row) {
        row.body = "";
      }

      await expect(
        service.updateStatus("proj-1", content.id, "PUBLISHED"),
      ).rejects.toThrow("발행 조건");
    });

    it("잘못된 status 값은 400, 없는 콘텐츠는 404", async () => {
      const { service, content } = await setup();
      await expect(
        service.updateStatus("proj-1", content.id, "LIVE"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateStatus("proj-1", "nope", "REVIEW"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it("없는 프로젝트는 404, 목록/단건 조회 동작", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const service = await createService(prisma);

    await expect(service.generate("nope", {})).rejects.toThrow(
      NotFoundException,
    );

    const created = await service.generate("proj-1", {});
    expect(await service.list("proj-1")).toHaveLength(1);
    expect((await service.getById("proj-1", created.id)).id).toBe(created.id);
    await expect(service.getById("proj-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
  });
});
