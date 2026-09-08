import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductProfileEngine } from "@acos/core";
import type { ProductProfileLlmClient } from "@acos/core";
import type { ProductProfile as ProductProfileRecord } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PrismaProductProfileRunStore } from "./prisma-product-profile-run.store";
import { ProductProfileService } from "./product-profile.service";

const validFeatures = {
  material: "PVC",
  color: "그레이",
  structure: "접이식 매트",
  usage: "주방 바닥 매트",
  components: ["매트 본체"],
  notes: null,
  confidence: 0.8,
  photoTypes: ["DESIGN", "DESIGN"],
  photoCaptions: ["접어서 세워 둔 모습", "펼쳐서 바닥에 깐 모습"],
};

const validProfile = {
  productName: "Magic Clean PVC 주방 매트",
  brand: "Magic Clean",
  model: null,
  material: "PVC",
  features: ["접이식"],
  specifications: {},
  usage: "주방 바닥에 깔아 사용",
  advantages: ["물세척 가능"],
  warnings: [],
  keywords: ["주방매트"],
  confidence: 0.75,
};

const validCopy = {
  headline: "접어서 보관하는 PVC 주방 매트",
  description: "물세척이 가능한 접이식 PVC 매트로 주방 바닥을 깔끔하게 지켜줍니다.",
};

/** product_profiles 테이블을 흉내 내는 인메모리 Prisma 목업 */
function createPrismaMock() {
  const rows = new Map<string, ProductProfileRecord>();
  let sequence = 0;

  const prisma = {
    rows,
    image: { findMany: jest.fn(), update: jest.fn() },
    ocrResult: { findFirst: jest.fn() },
    productProfile: {
      create: jest.fn(
        async ({ data }: { data: Partial<ProductProfileRecord> }) => {
          const now = new Date();
          const row = {
            id: `pp-${++sequence}`,
            imageIds: data.imageIds ?? [],
            projectId: data.projectId ?? null,
            status: data.status ?? "PENDING",
            ocrText: data.ocrText ?? null,
            imageFeatures: null,
            profile: null,
            pageCopy: null,
            html: null,
            css: null,
            templateKey: data.templateKey ?? null,
            userRequirement: data.userRequirement ?? null,
            provider: data.provider ?? null,
            error: null,
            attempts: 0,
            startedAt: data.startedAt ?? null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          } as ProductProfileRecord;
          rows.set(row.id, row);
          return { ...row };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ProductProfileRecord>;
        }) => {
          const row = rows.get(where.id) as ProductProfileRecord;
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({
        ...(rows.get(where.id) as ProductProfileRecord),
      })),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async () => [...rows.values()]),
    },
  };
  return prisma;
}

function stubEngine(complete: ProductProfileLlmClient): ProductProfileEngine {
  return new ProductProfileEngine({
    // 실제 프롬프트 문장을 만들지 않는 가짜 엔진이지만, 컨텍스트를 그대로
    // 직렬화해 돌려준다 — 이 층(서비스)에서도 userRequirement(T1-92) 같은
    // 값이 STEP별 컨텍스트에 실제로 실려 가는지 검사할 수 있어야 한다.
    promptEngine: {
      render: (_key: string, context: unknown) => [
        { role: "user" as const, content: JSON.stringify(context) },
      ],
    } as never,
    llmProviderName: "openai",
    complete,
  });
}

const defaultComplete: ProductProfileLlmClient = async (request) => ({
  provider: "openai",
  model: "gpt-4o",
  text:
    request.step === "vision"
      ? JSON.stringify(validFeatures)
      : request.step === "synthesis"
        ? JSON.stringify(validProfile)
        : JSON.stringify(validCopy),
});

describe("ProductProfileService (Service Test)", () => {
  async function createService(
    prisma: ReturnType<typeof createPrismaMock>,
    options: {
      complete?: ProductProfileLlmClient;
      budget?: unknown;
      storage?: { getObject: jest.Mock };
    } = {},
  ) {
    const storage = options.storage ?? { getObject: jest.fn(async () => Buffer.from("fake-image")) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductProfileService,
        PrismaProductProfileRunStore,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        {
          provide: ProductProfileEngine,
          useValue: stubEngine(options.complete ?? defaultComplete),
        },
        {
          provide: LlmBudgetService,
          useValue: options.budget ?? { assertWithinBudget: jest.fn() },
        },
      ],
    }).compile();
    return { service: moduleRef.get(ProductProfileService), storage };
  }

  const images = [
    { id: "img-1", key: "images/1.png", mimeType: "image/png" },
    { id: "img-2", key: "images/2.png", mimeType: "image/png" },
  ];

  it("이미지 여러 장으로 STEP 3+4를 실행해 SUCCESS Profile을 저장한다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const { service } = await createService(prisma);

    const result = await service.run(["img-1", "img-2"], "proj-1");

    expect(result.status).toBe("SUCCESS");
    expect(result.imageIds).toEqual(["img-1", "img-2"]);
    expect(result.projectId).toBe("proj-1");
    expect(result.imageFeatures).toEqual(validFeatures);
    expect(result.profile).toEqual(validProfile);
    expect(result.pageCopy).toEqual(validCopy);
    expect(result.html).toContain(validProfile.productName);
    expect(result.css).toContain(".pde-page");
    expect(result.provider).toBe("llm:openai");
  });

  it("imageIds가 비어 있으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    const { service } = await createService(prisma);

    await expect(service.run([])).rejects.toThrow(BadRequestException);
    await expect(service.run(["  "])).rejects.toThrow(BadRequestException);
  });

  it("존재하지 않는 이미지가 있으면 404를 던지고 실행 기록을 남기지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue([images[0]]); // img-2 누락
    const { service } = await createService(prisma);

    await expect(service.run(["img-1", "img-2"])).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.rows.size).toBe(0);
  });

  it("최신 SUCCESS OCR 텍스트를 근거로 넘긴다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue([images[0]]);
    prisma.ocrResult.findFirst.mockResolvedValue({
      extractedText: "Magic Clean PVC Mat",
    });
    const complete = jest.fn(defaultComplete);
    const { service } = await createService(prisma, { complete });

    const result = await service.run(["img-1"]);

    expect(result.ocrText).toBe("Magic Clean PVC Mat");
    const visionCall = complete.mock.calls.find(([r]) => r.step === "vision")![0];
    expect(visionCall.messages).toBeDefined();
  });

  it("예산을 초과하면 호출 전에 막고 실행 기록을 남기지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const { service } = await createService(prisma, {
      budget: {
        assertWithinBudget: jest.fn(async () => {
          throw new Error("일간 AI 비용 예산을 초과했습니다");
        }),
      },
    });

    await expect(service.run(["img-1", "img-2"])).rejects.toThrow(/예산을 초과/);
    expect(prisma.rows.size).toBe(0);
  });

  it("이미지 특징 분석(STEP 3) 응답이 깨지면 FAILED로 기록하고 정상 응답한다 — 5xx로 감추지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const { service } = await createService(prisma, {
      complete: async (request) =>
        request.step === "vision"
          ? { provider: "openai", model: "gpt-4o", text: "이건 JSON이 아니다" }
          : defaultComplete(request),
    });

    const result = await service.run(["img-1", "img-2"]);

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("JSON");
    expect(result.profile).toBeNull();
  });

  it("STEP 4는 이미지를 재첨부하지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const complete = jest.fn(defaultComplete);
    const { service } = await createService(prisma, { complete });

    await service.run(["img-1", "img-2"]);

    const synthesisCall = complete.mock.calls.find(
      ([r]) => r.step === "synthesis",
    )![0];
    expect(synthesisCall.images).toEqual([]);
  });

  it("사용자 요구사항(T1-92)을 넘기면 저장하고 STEP 5a 프롬프트에도 전달한다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const complete = jest.fn(defaultComplete);
    const { service } = await createService(prisma, { complete });

    const result = await service.run(
      ["img-1", "img-2"],
      "proj-1",
      undefined,
      "더 고급스러운 느낌으로 만들어줘",
    );

    expect(result.userRequirement).toBe("더 고급스러운 느낌으로 만들어줘");
    const copyCall = complete.mock.calls.find(([r]) => r.step === "copy")![0];
    const copyUserMessage = copyCall.messages.find((m) => m.role === "user");
    expect(copyUserMessage?.content).toContain("더 고급스러운 느낌으로 만들어줘");
  });

  it("사용자 요구사항 없이 실행하면 userRequirement는 null이다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const { service } = await createService(prisma);

    const result = await service.run(["img-1", "img-2"]);

    expect(result.userRequirement).toBeNull();
  });

  describe("updateUserRequirement()", () => {
    it("실행을 다시 돌리지 않고 저장만 한다 — LLM 호출 없음", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValue(images);
      const complete = jest.fn(defaultComplete);
      const { service } = await createService(prisma, { complete });
      const run = await service.run(["img-1", "img-2"]);
      complete.mockClear();

      const updated = await service.updateUserRequirement(run.id, {
        userRequirement: "주방 배경으로",
      });

      expect(updated.userRequirement).toBe("주방 배경으로");
      expect(complete).not.toHaveBeenCalled();
      // 실행 결과(status·profile 등)는 그대로 유지된다 — 재실행이 아니다
      expect(updated.status).toBe("SUCCESS");
      expect(updated.profile).toEqual(validProfile);
    });

    it("빈 문자열/공백은 null로 저장한다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValue(images);
      const { service } = await createService(prisma);
      const run = await service.run(["img-1", "img-2"], undefined, undefined, "처음 요구사항");

      const updated = await service.updateUserRequirement(run.id, { userRequirement: "   " });

      expect(updated.userRequirement).toBeNull();
    });

    it("없는 id에 404를 던진다", async () => {
      const prisma = createPrismaMock();
      const { service } = await createService(prisma);

      await expect(
        service.updateUserRequirement("nope", { userRequirement: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("userRequirementsByCategory(T1-99)는 지정한 카테고리만 갱신하고 나머지 기존 값은 남긴다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValue(images);
      const { service } = await createService(prisma);
      const run = await service.run(["img-1", "img-2"]);

      const first = await service.updateUserRequirement(run.id, {
        userRequirementsByCategory: { HERO: "대표 썸네일은 화이트 배경으로" },
      });
      expect(first.userRequirementsByCategory).toEqual({
        HERO: "대표 썸네일은 화이트 배경으로",
      });

      const second = await service.updateUserRequirement(run.id, {
        userRequirementsByCategory: { DETAIL: "디테일샷은 이음새를 크게" },
      });
      expect(second.userRequirementsByCategory).toEqual({
        HERO: "대표 썸네일은 화이트 배경으로",
        DETAIL: "디테일샷은 이음새를 크게",
      });

      const cleared = await service.updateUserRequirement(run.id, {
        userRequirementsByCategory: { HERO: null },
      });
      expect(cleared.userRequirementsByCategory).toEqual({
        DETAIL: "디테일샷은 이음새를 크게",
      });
    });

    it("userRequirement·userRequirementsByCategory는 서로 독립적으로 갱신된다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValue(images);
      const { service } = await createService(prisma);
      const run = await service.run(["img-1", "img-2"], undefined, undefined, "공용 요구사항");

      const updated = await service.updateUserRequirement(run.id, {
        userRequirementsByCategory: { HERO: "대표 썸네일 전용" },
      });

      // userRequirement를 보내지 않았으므로 기존 공용 값은 그대로다
      expect(updated.userRequirement).toBe("공용 요구사항");
      expect(updated.userRequirementsByCategory).toEqual({ HERO: "대표 썸네일 전용" });
    });
  });

  it("get()은 없는 id에 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const { service } = await createService(prisma);
    await expect(service.get("nope")).rejects.toThrow(NotFoundException);
  });

  it("getHtmlDocument()는 SUCCESS 실행의 HTML을 완전한 문서로 감싸 반환한다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const { service } = await createService(prisma);
    const run = await service.run(["img-1", "img-2"]);

    const doc = await service.getHtmlDocument(run.id);
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain(validProfile.productName);
    expect(doc).toContain(validCopy.headline);
  });

  it("getHtmlDocument()는 없는 id에 404를 던진다", async () => {
    const prisma = createPrismaMock();
    const { service } = await createService(prisma);
    await expect(service.getHtmlDocument("nope")).rejects.toThrow(NotFoundException);
  });

  it("getHtmlDocument()는 FAILED 실행처럼 html이 없으면 400을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany.mockResolvedValue(images);
    const { service } = await createService(prisma, {
      complete: async (request) =>
        request.step === "vision"
          ? { provider: "openai", model: "gpt-4o", text: "이건 JSON이 아니다" }
          : defaultComplete(request),
    });
    const run = await service.run(["img-1", "img-2"]);

    expect(run.status).toBe("FAILED");
    await expect(service.getHtmlDocument(run.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  // T1-75 — Image Studio 선택 이미지로 최종 상세페이지를 다시 조립한다
  describe("getFinalPage() / getFinalHtmlDocument()", () => {
    it("Image Studio에서 아무것도 선택하지 않았으면 STEP 5 결과(원본 업로드 사진 기준)를 그대로 돌려준다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValueOnce(images); // run()의 imageIds 조회
      const { service } = await createService(prisma);
      const run = await service.run(["img-1", "img-2"]);

      prisma.image.findMany.mockResolvedValueOnce([]); // getFinalPage()의 선택 이미지 조회
      const page = await service.getFinalPage(run.id);

      expect(page.imageSource).toBe("original-upload");
      expect(page.selectedImageCount).toBe(0);
      expect(page.html).toBe(run.html);
      expect(page.productName).toBe(validProfile.productName);
      expect(page.source).toBe("legacy");
    });

    it("Image Studio에서 카테고리별로 선택해 둔 이미지가 있으면 그것으로 다시 조립한다 — 추가 LLM 호출 없음", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValueOnce(images);
      const complete = jest.fn(defaultComplete);
      // key마다 다른 바이트를 돌려준다 — Image Studio 이미지로 다시 렌더링한
      // 결과가 원본 업로드 사진 렌더링 결과와 실제로 달라지는지(같은 자리에
      // 다른 base64가 박히는지) 검사할 수 있어야 한다.
      const storage = { getObject: jest.fn(async (key: string) => Buffer.from(key)) };
      const { service } = await createService(prisma, { complete, storage });
      const run = await service.run(["img-1", "img-2"]);
      complete.mockClear();

      prisma.image.findMany.mockResolvedValueOnce([
        {
          id: "gen-hero-1",
          key: "images/hero-1.png",
          mimeType: "image/png",
          category: "HERO",
          groupVersion: 2,
          photoType: null,
        },
        {
          id: "gen-feature-1",
          key: "images/feature-1.png",
          mimeType: "image/png",
          category: "FEATURE_HIGHLIGHT",
          groupVersion: 1,
          photoType: "DESIGN",
        },
      ]);

      const page = await service.getFinalPage(run.id);

      expect(page.imageSource).toBe("studio-selected");
      expect(page.selectedImageCount).toBe(2);
      expect(complete).not.toHaveBeenCalled();
      expect(storage.getObject).toHaveBeenCalledWith("images/hero-1.png");
      expect(storage.getObject).toHaveBeenCalledWith("images/feature-1.png");
      expect(page.html).not.toBe(run.html);
      expect(page.source).toBe("legacy");
    });

    it("Product Story가 저장돼 있으면(T1-131) 레거시 템플릿을 다시 조립하지 않고 그 결과를 그대로 돌려준다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValueOnce(images);
      const { service } = await createService(prisma);
      const run = await service.run(["img-1", "img-2"]);

      const storedStory = {
        story: { productName: "저장된 Story 상품명", narrativeSummary: "", sections: [] },
        html: "<div class=\"pde-page pde-page--story\">STORY HTML</div>",
        css: ".pde-page--story{color:red}",
        designPlan: { typography: { display: "", body: "", emphasis: "", numeric: "" }, sections: [] },
        validation: { ok: true, issues: [] },
        quality: { score: 90, grade: "pass", reasons: [] },
        attempts: 1,
        availableImages: [{ category: "HERO", count: 2 }, { category: "DETAIL", count: 1 }],
        auxiliaryVisuals: [],
        provider: "openai",
        model: "gpt-4o",
      };
      (prisma.rows.get(run.id) as Record<string, unknown>).storyResult = storedStory;
      const callsBeforeFinal = (prisma.image.findMany as jest.Mock).mock.calls.length;

      const page = await service.getFinalPage(run.id);

      expect(page.source).toBe("story");
      expect(page.html).toBe(storedStory.html);
      expect(page.css).toBe(storedStory.css);
      expect(page.productName).toBe("저장된 Story 상품명");
      expect(page.selectedImageCount).toBe(3);
      expect(page.imageSource).toBe("studio-selected");
      // 레거시 카테고리 조립 경로(이미지 재조회)를 타지 않는다 — Story 결과만 읽는다
      expect((prisma.image.findMany as jest.Mock).mock.calls.length).toBe(callsBeforeFinal);
    });

    it("getFinalPage()는 없는 id에 404를 던진다", async () => {
      const prisma = createPrismaMock();
      const { service } = await createService(prisma);
      await expect(service.getFinalPage("nope")).rejects.toThrow(NotFoundException);
    });

    it("getFinalHtmlDocument()는 완전한 HTML 문서로 감싸 반환한다", async () => {
      const prisma = createPrismaMock();
      prisma.image.findMany.mockResolvedValueOnce(images);
      const { service } = await createService(prisma);
      const run = await service.run(["img-1", "img-2"]);

      prisma.image.findMany.mockResolvedValueOnce([]);
      const doc = await service.getFinalHtmlDocument(run.id);
      expect(doc).toContain("<!DOCTYPE html>");
      expect(doc).toContain(validProfile.productName);
    });
  });
});
