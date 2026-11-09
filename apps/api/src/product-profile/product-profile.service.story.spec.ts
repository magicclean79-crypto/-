import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductProfileEngine } from "@acos/core";
import type { ProductProfileLlmClient } from "@acos/core";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import { ImageGenService } from "../image-gen/image-gen.service";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PrismaProductProfileRunStore } from "./prisma-product-profile-run.store";
import { ProductProfileService } from "./product-profile.service";

/**
 * `ProductProfileService.generateStory()` 전용 스펙 (T1-94). 기존
 * `product-profile.service.spec.ts`는 이 작업이 진행되는 동안 다른 동시
 * 진행 작업(T1-92/T1-93)이 계속 수정하고 있어(`docs/PROJECT_MEMORY.md`가
 * 기록한 동시 진행 세션 충돌과 같은 위험), 그 파일을 함께 고치지 않고
 * 별도 파일로 둔다.
 */

const profile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터",
  model: "SJ-100",
  material: "ABS, PVC, 스테인리스",
  features: ["분사기 손잡이", "3M 길이 호스"],
  specifications: { 길이: "3M" },
  usage: "베란다에서 물을 뿌려 청소할 때 사용",
  advantages: ["3M 길이로 넓은 범위 청소 가능"],
  warnings: [],
  keywords: ["호스"],
  confidence: 0.9,
};

/** Design Director(T1-176)가 호출될 때 돌려주는 유효한 DESIGN_PROFILE 응답 — 기본 mock이 이 값을 쓴다 */
const designProfileResponseText = JSON.stringify({
  visualStyle: "industrial-premium",
  colorway: "harbor-steel",
  rationale: "금속/플라스틱 소재의 실용적 청소 도구라 industrial-premium 톤을 선택함",
  typography: { headingWeight: "700", letterSpacing: "tight", lineHeight: "comfortable", numericStyle: "tabular", accentTypeface: "technical-grotesk" },
  iconStyle: { family: "technical-outline", strokeWidth: "regular", cornerStyle: "sharp", opticalSize: "standard" },
  cardStyle: { variant: "soft-shadow", radius: "soft" },
  graphicMotif: { family: "dot-grid", intensity: "subtle" },
  spacingDensity: "standard",
  imageTreatment: { backgroundTreatment: "letterbox-neutral" },
  accentUsage: "balanced",
  avoid: [],
});

/**
 * `feature` 옵션으로 Story 호출과 Design Director 호출을 구분해 서로 다른
 * 응답을 돌려주는 mock(T1-176). 기존 테스트 다수가 `llm.complete`를 단일
 * 응답(`storyResponseText`)으로만 stub했는데, 이제 `generateStory` 안에서
 * Design Director 호출이 하나 더 나가므로(캐시 없는 최초 호출 기준) 그
 * 호출도 유효한 JSON을 받아야 조용히 fallback(null)으로 빠지지 않고 실제
 * 경로를 검증할 수 있다.
 */
function featureAwareComplete(storyText: string) {
  return jest.fn(
    async (
      _request: unknown,
      options?: { feature?: string },
    ): Promise<{ provider: string; model: string; text: string }> =>
      options?.feature === "product-profile-design-director"
        ? { provider: "openai", model: "gpt-4o", text: designProfileResponseText }
        : { provider: "openai", model: "gpt-4o", text: storyText },
  );
}

/** `llm.complete` mock 호출 중 주어진 feature로 호출된 call을 찾는다(T1-176 — Design Director 호출이 하나 더 섞여 있으므로 인덱스 대신 feature로 찾는다) */
function findCallByFeature(mock: jest.Mock, feature: string): unknown[] | undefined {
  return mock.mock.calls.find((call) => (call[1] as { feature?: string } | undefined)?.feature === feature);
}

const storyResponseText = JSON.stringify({
  productName: profile.productName,
  narrativeSummary: "베란다 청소가 번거로운 상황과 호스 길이의 관계를 설명한다.",
  sections: [
    {
      sectionId: "problem",
      purpose: "문제 제기",
      customerContext: "베란다 구석 청소가 번거롭다",
      productFacts: ["3M 길이 호스"],
      keyMessage: "긴 호스로 구석까지 닿는다",
      imageRole: "USAGE_SCENE",
      imageFactsShown: ["베란다에서 물을 뿌리는 장면"],
      copy: "베란다 끝까지 손이 닿지 않는 순간, 3M 길이 호스가 그 거리를 채워줍니다.",
      transitionToNext: "이 호스의 실제 구조를 다음에서 본다",
    },
    {
      sectionId: "detail",
      purpose: "제품 디테일",
      customerContext: "실제로 어떻게 생겼는지 궁금하다",
      productFacts: ["분사기 손잡이"],
      keyMessage: "분사기 손잡이 구조를 확인한다",
      imageRole: "DETAIL",
      imageFactsShown: ["분사기 손잡이 클로즈업"],
      copy: "분사기 손잡이를 쥐고 원하는 방향으로 바로 물을 뿌릴 수 있습니다.",
      transitionToNext: "",
    },
  ],
});

function createPrismaMock(
  recordOverrides: Record<string, unknown> = {},
  extraImages: Record<string, unknown>[] = [],
) {
  return {
    productProfile: {
      findUnique: jest.fn(async (): Promise<Record<string, unknown> | null> => ({
        id: "pp-1",
        imageIds: ["img-1", "img-2"],
        projectId: null,
        status: "SUCCESS",
        ocrText: "베란다용 스텐 호스 세트 3M",
        imageFeatures: null,
        profile,
        pageCopy: { headline: "h", description: "d" },
        html: "<div></div>",
        css: "",
        templateKey: "basic",
        userRequirement: null,
        storyResult: null,
        storyGeneratedAt: null,
        provider: "openai",
        error: null,
        attempts: 1,
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...recordOverrides,
      })),
      update: jest.fn(async () => ({})),
    },
    image: {
      findMany: jest.fn(async () => [
        {
          id: "sel-1",
          key: "images/sel-1.png",
          mimeType: "image/png",
          category: "USAGE_SCENE",
          groupVersion: 1,
        },
        {
          id: "sel-2",
          key: "images/sel-2.png",
          mimeType: "image/png",
          category: "DETAIL",
          groupVersion: 1,
        },
        ...extraImages,
      ]),
    },
  };
}

function stubEngine(): ProductProfileEngine {
  const complete: ProductProfileLlmClient = async () => ({ provider: "openai", model: "gpt-4o", text: "{}" });
  return new ProductProfileEngine({
    promptEngine: { render: () => [{ role: "user" as const, content: "x" }] } as never,
    llmProviderName: "openai",
    complete,
  });
}

async function createService(options: {
  prisma?: ReturnType<typeof createPrismaMock>;
  llm?: { complete: jest.Mock };
  promptEngine?: { render: jest.Mock };
  budget?: { assertWithinBudget: jest.Mock };
  imageGen?: { generateAuxiliaryVisual: jest.Mock; generateDesignAsset?: jest.Mock };
} = {}) {
  const prisma = options.prisma ?? createPrismaMock();
  const storage = { getObject: jest.fn(async () => Buffer.from("fake-image-bytes")) };
  const llm = options.llm ?? { complete: featureAwareComplete(storyResponseText) };
  const promptEngine = options.promptEngine ?? { render: jest.fn(() => [{ role: "user", content: "x" }]) };
  const budget = options.budget ?? { assertWithinBudget: jest.fn() };

  const providers: unknown[] = [
    ProductProfileService,
    PrismaProductProfileRunStore,
    { provide: PrismaService, useValue: prisma },
    { provide: StorageService, useValue: storage },
    { provide: ProductProfileEngine, useValue: stubEngine() },
    { provide: LlmBudgetService, useValue: budget },
    { provide: LlmService, useValue: llm },
    { provide: PROMPT_ENGINE, useValue: promptEngine },
  ];
  if (options.imageGen) {
    providers.push({ provide: ImageGenService, useValue: options.imageGen });
  }

  const moduleRef = await Test.createTestingModule({
    providers: providers as never,
  }).compile();
  return { service: moduleRef.get(ProductProfileService), prisma, llm, promptEngine, budget };
}

describe("ProductProfileService.generateStory (T1-94)", () => {
  it("검증된 실제 이미지가 선택되어 있으면 Product Story를 생성하고 이미지를 배정한다", async () => {
    const { service, llm } = await createService();
    const result = await service.generateStory("pp-1");

    expect(result.story.sections).toHaveLength(2);
    expect(result.story.sections[0].assignedImageId).toBe("sel-1");
    expect(result.story.sections[1].assignedImageId).toBe("sel-2");
    expect(result.html).toContain("data:image/png;base64,");
    expect(result.availableImages).toEqual(
      expect.arrayContaining([
        { category: "USAGE_SCENE", count: 1 },
        { category: "DETAIL", count: 1 },
      ]),
    );
    // T1-176: Design Director(캐시 없는 최초 호출) 1회 + Story Copywriter 1회 = 2회
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it("검증된 브랜드·모델·재질·규격·주요 기능이 Story 카피와 무관하게 항상 제품 정보 패널로 렌더링된다 (T1-139)", async () => {
    // 사용자 지적(T1-139 발주 사유): 실제 생성 결과에서 재질·규격·원산지
    // 같은 상품 정보가 통째로 빠졌다 — LLM이 만든 productFacts에 의존하지
    // 않고 검증된 Product Profile 값에서 항상 렌더링되는지 직접 확인한다.
    const prisma = createPrismaMock({
      imageFeatures: { components: ["분사기 손잡이", "고무 패킹 2개"] },
    });
    const { service } = await createService({ prisma });
    const result = await service.generateStory("pp-1");

    expect(result.html).toContain('data-panel="product-facts"');
    expect(result.html).toContain(profile.brand);
    expect(result.html).toContain(profile.model);
    expect(result.html).toContain(profile.material);
    expect(result.html).toContain("3M"); // specifications.길이
    expect(result.html).toContain("분사기 손잡이");
    expect(result.html).toContain("고무 패킹 2개");
  });

  it("문제 없는 Story는 품질 점수가 70점 이상이고 1회만 시도한다 (T1-97)", async () => {
    const { service, llm } = await createService();
    const result = await service.generateStory("pp-1");

    expect(result.attempts).toBe(1);
    expect(result.quality.grade).not.toBe("fail");
    expect(result.quality.score).toBeGreaterThanOrEqual(70);
    // T1-176: Design Director(캐시 없는 최초 호출) 1회 + Story Copywriter 1회 = 2회
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it("품질 검사에서 fail(70점 미만)이면 딱 1회 재생성하고, 재생성 결과가 좋으면 그것을 쓴다 (T1-97)", async () => {
    const badResponseText = JSON.stringify({
      productName: profile.productName,
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "s1",
          purpose: "소개",
          customerContext: "상황",
          productFacts: ["3M 길이 호스"],
          keyMessage: "핵심",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "이것은 최고의 제품입니다. 완벽한 선택입니다. 강력 추천합니다.",
          transitionToNext: "",
        },
      ],
    });
    // T1-176: Design Director 호출은 캐시 없는 최초 호출이라 먼저 1회
    // 나가고, 그 다음 Story Copywriter가 bad → good 순으로 재시도한다.
    let storyCallCount = 0;
    const complete = jest.fn(async (_request: unknown, options?: { feature?: string }) => {
      if (options?.feature === "product-profile-design-director") {
        return { provider: "openai", model: "gpt-4o", text: designProfileResponseText };
      }
      storyCallCount += 1;
      return {
        provider: "openai",
        model: "gpt-4o",
        text: storyCallCount === 1 ? badResponseText : storyResponseText,
      };
    });
    const { service } = await createService({ llm: { complete } });

    const result = await service.generateStory("pp-1");

    // Design Director 1회 + Story 2회(bad → 재시도 good) = 3회
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result.attempts).toBe(2);
    expect(result.quality.grade).not.toBe("fail");
    // 두 번째 Story 호출에는 첫 시도의 block 이슈가 피드백으로 포함되어야 한다
    const storyCalls = complete.mock.calls.filter(
      (call) => (call[1] as { feature?: string } | undefined)?.feature === "product-profile-story",
    );
    expect(storyCalls).toHaveLength(2);
    const secondCallMessages = (storyCalls[1][0] as { messages: { content: string }[] }).messages;
    const feedbackMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(feedbackMessage.content).toContain("generic-copy");
  });

  it("ANTHROPIC_API_KEY가 있으면 Copywriter 호출 시 anthropic을 우선 provider로 넘긴다 (T1-97)", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const { service, llm } = await createService();
      await service.generateStory("pp-1");
      const storyCall = findCallByFeature(llm.complete as jest.Mock, "product-profile-story");
      const callOptions = storyCall?.[1] as { provider?: string } | undefined;
      expect(callOptions?.provider).toBe("anthropic");
    } finally {
      if (previous === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previous;
      }
    }
  });

  it("ANTHROPIC_API_KEY가 없으면 provider를 강제하지 않는다(기존 라우팅/기본값 유지)", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { service, llm } = await createService();
      await service.generateStory("pp-1");
      const storyCall = findCallByFeature(llm.complete as jest.Mock, "product-profile-story");
      const callOptions = storyCall?.[1] as { provider?: string } | undefined;
      expect(callOptions?.provider).toBeUndefined();
    } finally {
      if (previous !== undefined) {
        process.env.ANTHROPIC_API_KEY = previous;
      }
    }
  });

  it("선택된 이미지가 하나도 없으면 400을 던지고 LLM을 호출하지 않는다", async () => {
    const prisma = createPrismaMock();
    prisma.image.findMany = jest.fn(async () => []);
    const { service, llm } = await createService({ prisma });

    await expect(service.generateStory("pp-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("실행 전에 비용 예산을 확인한다", async () => {
    const { service, budget } = await createService();
    await service.generateStory("pp-1");
    expect(budget.assertWithinBudget).toHaveBeenCalledWith({ what: "Product Story 생성 (Gemini/GPT)" });
  });

  it("호출 시 넘긴 userRequirement가 저장된 값을 덮어써 프롬프트에 쓰인다", async () => {
    const { service, promptEngine } = await createService();
    await service.generateStory("pp-1", "캠핑에서도 쓸 수 있다는 점을 강조해주세요");
    const context = promptEngine.render.mock.calls[0][1];
    expect(context.userRequirement).toBe("캠핑에서도 쓸 수 있다는 점을 강조해주세요");
  });

  it("존재하지 않는 실행 id면 NotFoundException을 던진다", async () => {
    const prisma = createPrismaMock();
    prisma.productProfile.findUnique = jest.fn(async () => null);
    const { service } = await createService({ prisma });
    await expect(service.generateStory("missing")).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("성공하면 결과를 storyResult로 저장한다 (T1-131 — /final이 재호출 없이 서빙할 수 있도록)", async () => {
    const { service, prisma } = await createService();
    const result = await service.generateStory("pp-1");

    // T1-176: designProfile 캐시 저장(1회) + storyResult 저장(1회) = 2회
    expect(prisma.productProfile.update).toHaveBeenCalledTimes(2);
    const calls = (prisma.productProfile.update as jest.Mock).mock.calls as { 0: { where: unknown; data: Record<string, unknown> } }[];
    const storyCall = calls.map((c) => c[0]).find((c) => "storyResult" in c.data);
    expect(storyCall?.where).toEqual({ id: "pp-1" });
    expect(storyCall?.data.storyResult).toEqual(result);
    expect(storyCall?.data.storyGeneratedAt).toBeInstanceOf(Date);
    const designProfileCall = calls.map((c) => c[0]).find((c) => "designProfile" in c.data);
    expect(designProfileCall?.where).toEqual({ id: "pp-1" });
    expect(designProfileCall?.data.designProfileGeneratedAt).toBeInstanceOf(Date);
  });

  it("저장이 실패해도 이번 호출의 결과는 그대로 반환한다", async () => {
    const prisma = createPrismaMock();
    prisma.productProfile.update = jest.fn(async () => {
      throw new Error("DB 쓰기 실패");
    });
    const { service } = await createService({ prisma });

    const result = await service.generateStory("pp-1");
    expect(result.story.sections).toHaveLength(2);
  });
});

/**
 * 보조 그래픽(추상 배경/강조 아트) 실 생성 배선 (T1-123). 실제 제품
 * 사진이 없는 섹션이 있는 3섹션 Story를 써서 `planAuxiliaryVisuals`가
 * 실제로 계획을 만들도록 한다("insight" 섹션 — imageRole NONE, 근거 없이
 * 20자 이상 카피, notice/spec/step/problem 패턴에 걸리지 않아 text-only로
 * 분류된다. 총 3섹션이라 마지막 섹션은 closing으로 분리되지만 이 섹션은
 * 가운데라 영향을 받지 않는다).
 */
const storyWithTextOnlySectionResponseText = JSON.stringify({
  productName: profile.productName,
  narrativeSummary: "베란다 청소가 번거로운 상황과 호스 길이의 관계를 설명한다.",
  sections: [
    {
      sectionId: "problem",
      purpose: "문제 제기",
      customerContext: "베란다 구석 청소가 번거롭다",
      productFacts: ["3M 길이 호스"],
      keyMessage: "긴 호스로 구석까지 닿는다",
      imageRole: "USAGE_SCENE",
      imageFactsShown: ["베란다에서 물을 뿌리는 장면"],
      copy: "베란다 끝까지 손이 닿지 않는 순간, 3M 길이 호스가 그 거리를 채워줍니다.",
      transitionToNext: "이 제품을 믿을 수 있는 이유를 본다",
    },
    {
      sectionId: "insight",
      purpose: "브랜드 신뢰",
      customerContext: "처음 보는 브랜드라 망설여진다",
      productFacts: [],
      keyMessage: "오랜 노하우로 만든 제품입니다",
      imageRole: "NONE",
      imageFactsShown: [],
      copy: "오랜 시간 축적된 생활용품 제작 노하우를 바탕으로 꼼꼼하게 만들었습니다.",
      transitionToNext: "실제 구조를 다음에서 본다",
    },
    {
      sectionId: "detail",
      purpose: "제품 디테일",
      customerContext: "실제로 어떻게 생겼는지 궁금하다",
      productFacts: ["분사기 손잡이"],
      keyMessage: "분사기 손잡이 구조를 확인한다",
      imageRole: "DETAIL",
      imageFactsShown: ["분사기 손잡이 클로즈업"],
      copy: "분사기 손잡이를 쥐고 원하는 방향으로 바로 물을 뿌릴 수 있습니다.",
      transitionToNext: "",
    },
  ],
});

describe("ProductProfileService.generateStory — 보조 그래픽 실 생성 (T1-123)", () => {
  it("imageGen이 연결되지 않으면 보조 그래픽을 시도하지 않고 그 사실을 보고한다", async () => {
    const llm = { complete: jest.fn(async () => ({ provider: "openai", model: "gpt-4o", text: storyWithTextOnlySectionResponseText })) };
    const { service } = await createService({ llm });

    const result = await service.generateStory("pp-1");

    expect(result.auxiliaryVisuals).toHaveLength(1);
    expect(result.auxiliaryVisuals[0]).toMatchObject({ sectionId: "insight", generated: false });
    expect(result.auxiliaryVisuals[0].reason).toContain("연결되지 않아");
    expect(result.html).not.toContain("gemini-auxiliary");
  });

  it("imageGen이 연결되어 있으면 실제 제품 사진이 없는 섹션에만 보조 그래픽을 생성해 최종 HTML에 반영한다", async () => {
    const llm = { complete: jest.fn(async () => ({ provider: "openai", model: "gpt-4o", text: storyWithTextOnlySectionResponseText })) };
    const generateAuxiliaryVisual = jest.fn(async () => ({
      imageBytes: "ZmFrZS1hdXgtYnl0ZXM=",
      mimeType: "image/png",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
    }));
    const { service } = await createService({ llm, imageGen: { generateAuxiliaryVisual } });

    const result = await service.generateStory("pp-1");

    expect(generateAuxiliaryVisual).toHaveBeenCalledTimes(1);
    expect(result.auxiliaryVisuals).toEqual([
      { sectionId: "insight", role: expect.any(String), generated: true, reason: expect.any(String) },
    ]);
    expect(result.html).toContain('data-visual-source="gemini-auxiliary"');
    expect(result.html).toContain("ZmFrZS1hdXgtYnl0ZXM=");
  });

  it("보조 그래픽 생성이 실패해도 Story 생성 자체는 실패하지 않고 실패 이유를 보고한다", async () => {
    const llm = { complete: jest.fn(async () => ({ provider: "openai", model: "gpt-4o", text: storyWithTextOnlySectionResponseText })) };
    const generateAuxiliaryVisual = jest.fn(async () => {
      throw new Error("Gemini가 정책상 이미지를 거부했습니다");
    });
    const { service } = await createService({ llm, imageGen: { generateAuxiliaryVisual } });

    const result = await service.generateStory("pp-1");

    expect(result.auxiliaryVisuals).toEqual([
      { sectionId: "insight", role: expect.any(String), generated: false, reason: "Gemini가 정책상 이미지를 거부했습니다" },
    ]);
    expect(result.html).not.toContain("gemini-auxiliary");
    expect(result.story.sections).toHaveLength(3);
  });

  it("모든 섹션에 실제 제품 사진이 배정되면 imageGen이 있어도 호출하지 않는다", async () => {
    const generateAuxiliaryVisual = jest.fn();
    const { service } = await createService({ imageGen: { generateAuxiliaryVisual } });

    const result = await service.generateStory("pp-1");

    expect(generateAuxiliaryVisual).not.toHaveBeenCalled();
    expect(result.auxiliaryVisuals).toEqual([]);
  });
});

/**
 * Hero 타이포그래피 모티프 실 생성 배선 (T1-142, T1-185에서 아이콘 생성
 * 제거). `storyResponseText`(2섹션 — image-feature/icon "check",
 * detail-callout/icon "info")를 그대로 쓴다.
 *
 * T1-185: 아이콘은 T1-177 이후 항상 DESIGN_PROFILE.iconStyle의 canonical
 * SVG(`data-icon-source="design-profile-svg"`)로만 렌더링되고
 * `renderProductStoryHtml`은 `generativeVisuals.icons`를 읽지 않는다
 * (`product-story-html.ts` 참고). 그런데도 이 서비스는 계속 Story마다
 * Gemini `generateDesignAsset`를 아이콘 종류 수만큼 호출해 결과를 버리고
 * 있었다 — 실측으로 확인한 순수 비용 낭비라 호출 자체를 제거했다. 아래
 * 테스트는 그 제거 후의 실제 동작(Hero 모티프만 생성 시도, 아이콘은
 * `imageGen` 연결 여부와 무관하게 항상 canonical SVG)을 검증한다.
 */
describe("ProductProfileService.generateStory — Hero 모티프 실 생성 (T1-142/T1-185)", () => {
  it("imageGen이 연결되지 않으면 Hero 모티프를 시도하지 않고 그 사실을 보고하며, 아이콘은 항상 canonical SVG로 렌더링된다", async () => {
    const { service } = await createService();

    const result = await service.generateStory("pp-1");

    expect(result.generativeVisuals.length).toBeGreaterThan(0);
    expect(result.generativeVisuals.every((v) => !v.generated)).toBe(true);
    expect(result.generativeVisuals.every((v) => v.reason.includes("연결되지 않아"))).toBe(true);
    expect(result.html).not.toContain("gemini-generative-design");
    expect(result.html).toContain('data-icon-source="design-profile-svg"');
  });

  it("imageGen이 연결되어 있으면 Hero 모티프만 1회 생성해 최종 HTML에 반영하고, 아이콘 생성은 시도하지 않는다", async () => {
    const generateAuxiliaryVisual = jest.fn();
    const generateDesignAsset = jest.fn(async () => ({
      imageBytes: "ZmFrZS1nZW4tYnl0ZXM=",
      mimeType: "image/png",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
    }));
    const { service } = await createService({ imageGen: { generateAuxiliaryVisual, generateDesignAsset } });

    const result = await service.generateStory("pp-1");

    // Hero 모티프 1개만 시도한다 — 아이콘 생성 호출은 T1-185에서 제거됐다.
    expect(generateDesignAsset).toHaveBeenCalledTimes(1);
    expect(result.generativeVisuals.filter((v) => v.generated)).toHaveLength(1);
    // 아이콘은 여전히 canonical SVG로만 그려진다 — Gemini 생성 자산이
    // 아이콘 자리에 등장하지 않는다(T1-177 회귀 방지, 이제 애초에 아이콘
    // 생성 자체를 시도하지 않으므로 이중으로 보장된다).
    expect(result.html).toContain('data-icon-source="design-profile-svg"');
    // Hero 모티프는 story-summary 구분선 배경으로 재사용된다(T1-173).
    expect(result.html).toContain("gemini-generative-design");
    expect(result.html).toContain("ZmFrZS1nZW4tYnl0ZXM=");
    expect(result.html).not.toContain("pde-hero-motif");
    expect(result.html).toContain("pde-story-summary-motif");
  });

  it("Hero 모티프 생성이 실패해도 Story 생성 자체는 실패하지 않는다", async () => {
    const generateAuxiliaryVisual = jest.fn();
    const generateDesignAsset = jest.fn(async () => {
      throw new Error("Gemini가 정책상 이미지를 거부했습니다");
    });
    const { service } = await createService({ imageGen: { generateAuxiliaryVisual, generateDesignAsset } });

    const result = await service.generateStory("pp-1");

    expect(result.generativeVisuals.every((v) => !v.generated)).toBe(true);
    expect(result.generativeVisuals.every((v) => v.reason === "Gemini가 정책상 이미지를 거부했습니다")).toBe(true);
    expect(result.html).not.toContain("gemini-generative-design");
    expect(result.html).toContain('data-icon-source="design-profile-svg"');
    expect(result.story.sections).toHaveLength(2);
  });
});

describe("ProductProfileService.generateStory — 이미지 밀도 확대 (T1-144)", () => {
  it("결과에 실제 페이지에 쓰인 시각 asset 수(assetInventory)를 사실대로 집계해 담는다", async () => {
    const { service } = await createService();
    const result = await service.generateStory("pp-1");

    // 기본 픽스처(sel-1 USAGE_SCENE·sel-2 DETAIL)는 둘 다 kind 없음 →
    // "generated"로 취급되고, 두 섹션 모두 대표 이미지로 배정된다.
    // 이 테스트는 imageGen을 연결하지 않았으므로 생성형 아이콘/모티프는 0.
    expect(result.assetInventory.realProductPhotos).toBe(0);
    expect(result.assetInventory.generativeProductVisuals).toBe(2);
    expect(result.assetInventory.generativeDesignAssets).toBe(0);
    expect(result.assetInventory.totalVisualAssets).toBe(2);
    expect(result.assetInventory.byCategory).toEqual({ USAGE_SCENE: 1, DETAIL: 1 });
  });

  it("실제 업로드 원본(kind=ORIGINAL)이 선택돼 있고 같은 카테고리를 쓰는 섹션이 있으면 source=real로 그 섹션 갤러리에 합쳐진다", async () => {
    // Story의 두 섹션(USAGE_SCENE·DETAIL)은 storyResponseText가 고정한다 —
    // 여기서는 그 중 하나와 같은 카테고리(USAGE_SCENE)의 실제 원본을
    // 추가해, "카테고리가 일치하는 섹션의 갤러리로 합쳐진다"(T1-147)는
    // 경로를 검증한다.
    const prisma = createPrismaMock({}, [
      {
        id: "orig-usage-1",
        key: "images/orig-usage-1.jpg",
        mimeType: "image/jpeg",
        category: "USAGE_SCENE",
        groupVersion: 1,
        kind: "ORIGINAL",
      },
    ]);
    const { service } = await createService({ prisma });
    const result = await service.generateStory("pp-1");

    // 원본 1장 + crop 최대 2장(진짜 사진 바이트가 아니라 "fake-image-bytes"
    // 텍스트라 sharp가 처리하지 못해 crop이 0장일 수도 있다 — crop은
    // 향상일 뿐 필수가 아니므로 실패해도 원본 자체는 반드시 남는다).
    expect(result.assetInventory.realProductPhotos).toBeGreaterThanOrEqual(1);
    expect(result.assetInventory.byCategory.USAGE_SCENE).toBeGreaterThanOrEqual(2);
    expect(result.html).toContain('data-asset-source="real"');
  });

  it("어느 섹션도 쓰지 않는 카테고리의 남은 실제 사진은 별도 회수 섹션 없이 조용히 빠진다(T1-147) — 맥락이 안 맞는 자리에 억지로 넣지 않는다", async () => {
    // Story의 두 섹션은 USAGE_SCENE·DETAIL만 쓴다 — COMPONENTS를 쓰는
    // 섹션이 없으므로 이 실제 원본은 폴드될 곳이 없다.
    const prisma = createPrismaMock({}, [
      {
        id: "orig-components-1",
        key: "images/orig-components-1.jpg",
        mimeType: "image/jpeg",
        category: "COMPONENTS",
        groupVersion: 1,
        kind: "ORIGINAL",
      },
    ]);
    const { service } = await createService({ prisma });
    const result = await service.generateStory("pp-1");

    expect(result.html).not.toContain("pde-media-gallery");
    expect(result.html).not.toContain("제품 더 보기");
    expect(result.assetInventory.byCategory.COMPONENTS ?? 0).toBe(0);
  });
});
