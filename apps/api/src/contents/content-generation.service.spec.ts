import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { LlmCompleteRequest } from "@acos/shared";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { ContentGenerationService } from "./content-generation.service";
import {
  createPrismaMock,
  readyProductObject,
} from "./contents.spec-helpers";

const GENERATED_MARKDOWN = "# 물만으로 깨끗하게, 매직클린 매트\n\n놀라운 본문";

function createLlmMock() {
  return {
    complete: jest.fn(async (request: LlmCompleteRequest) => ({
      provider: "mock",
      model: "mock-llm-1",
      text: GENERATED_MARKDOWN,
      usage: { inputTokens: 100, outputTokens: 50 },
      createdAt: new Date().toISOString(),
      _request: request,
    })),
  };
}

function createCompanyBrainMock(options?: { bannedWords?: unknown }) {
  return {
    query: jest.fn(async (request: { query: string }) => ({
      query: request.query,
      results: [
        {
          source: "MEMORY",
          items:
            request.query === "banned-words" &&
            options?.bannedWords !== undefined
              ? [
                  {
                    id: "mem-1",
                    scope: "GLOBAL",
                    scopeId: null,
                    key: "banned-words",
                    value: options.bannedWords,
                    description: null,
                    createdAt: "",
                    updatedAt: "",
                  },
                ]
              : [],
        },
        {
          source: "KNOWLEDGE",
          items:
            request.query === "banned-words"
              ? []
              : [
                  {
                    id: "kn-1",
                    title: "브랜드 가이드",
                    content: "친근한 어조를 유지한다",
                    category: "BRAND",
                    createdAt: "",
                    updatedAt: "",
                  },
                ],
        },
        { source: "DECISION", items: [] },
        { source: "SOP", items: [] },
      ],
    })),
  };
}

describe("ContentGenerationService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    companyBrain = createCompanyBrainMock({ bannedWords: ["최고", "1위"] }),
    llm = createLlmMock(),
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentGenerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyBrainService, useValue: companyBrain },
        { provide: LlmService, useValue: llm },
      ],
    }).compile();
    return {
      service: moduleRef.get(ContentGenerationService),
      companyBrain,
      llm,
    };
  }

  it("READY PO + Company Brain + LLM Gateway로 Markdown을 생성해 Content에 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const { service, companyBrain, llm } = await createService(prisma);

    const content = await service.generate("proj-1", {});

    // 생성 결과가 Content로 저장되고 제목은 Markdown 헤딩에서 추출
    expect(content.body).toBe(GENERATED_MARKDOWN);
    expect(content.title).toBe("물만으로 깨끗하게, 매직클린 매트");
    expect(content.productObjectVersion).toBe(2);
    expect(content.status).toBe("DRAFT");
    expect(prisma.contents.size).toBe(1);

    // ② Company Brain 조회: 금지어(GLOBAL) + 제목 검색(PROJECT)
    expect(companyBrain.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: "banned-words", scope: "GLOBAL" }),
    );
    expect(companyBrain.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: readyProductObject.title,
        scope: "PROJECT",
        scopeId: "proj-1",
      }),
    );

    // ③ LLM Gateway 호출 — 프롬프트에 상품·지식·금지어가 반영됨
    const request = llm.complete.mock.calls[0][0];
    const system = request.messages[0].content;
    const user = request.messages[1].content;
    expect(request.messages[0].role).toBe("system");
    expect(system).toContain("최고, 1위"); // 금지어 지침
    expect(user).toContain("Magic Clean PVC Mat"); // Product Object
    expect(user).toContain("브랜드 가이드"); // Knowledge
  });

  it("헤딩 없는 LLM 응답은 fallback 제목(<상품명> 상세페이지)을 쓴다", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const llm = createLlmMock();
    llm.complete.mockResolvedValue({
      provider: "mock",
      model: "mock-llm-1",
      text: "헤딩 없는 본문",
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: new Date().toISOString(),
    } as never);
    const { service } = await createService(
      prisma,
      createCompanyBrainMock({}),
      llm,
    );

    const content = await service.generate("proj-1", {});
    expect(content.title).toBe("Magic Clean PVC Mat 상세페이지");
  });

  it("READY 규칙 — READY 없음 400, DRAFT 버전 지정 400, 없는 버전 404", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({
      ...readyProductObject,
      version: 1,
      status: "DRAFT",
      id: "po-d",
    });
    const { service } = await createService(prisma);

    await expect(service.generate("proj-1", {})).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.generate("proj-1", { productObjectVersion: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.generate("proj-1", { productObjectVersion: 9 }),
    ).rejects.toThrow(NotFoundException);
  });

  it("없는 프로젝트 404 · 금지어 미설정이어도 생성 성공", async () => {
    const prisma = createPrismaMock();
    prisma.productObjects.push({ ...readyProductObject });
    const { service, llm } = await createService(
      prisma,
      createCompanyBrainMock({}),
    );

    await expect(service.generate("nope", {})).rejects.toThrow(
      NotFoundException,
    );

    const content = await service.generate("proj-1", {});
    expect(content.body).toBe(GENERATED_MARKDOWN);
    const system = llm.complete.mock.calls[0][0].messages[0].content;
    expect(system).not.toContain("금지어는 절대");
  });
});
