import {
  buildAuxiliaryVisualPrompt,
  dryRunAuxiliaryVisualPlan,
  planAuxiliaryVisuals,
} from "./product-story-auxiliary-visual";
import type { AssignedStorySection, ProductStory, ProductStorySection } from "./product-story";
import { planStoryDesign } from "./product-story-design";
import type { ProductProfile } from "@acos/shared";
import type { StudioSelectedImage } from "./product-page-images";

function section(overrides: Partial<ProductStorySection> = {}): ProductStorySection {
  return {
    sectionId: "s1",
    purpose: "일반",
    customerContext: "상황",
    productFacts: ["사실1", "사실2"],
    keyMessage: "긴 호스로 구석까지 닿는다",
    imageRole: "NONE",
    imageFactsShown: [],
    copy: "베란다 끝까지 손이 닿지 않아 청소를 미루게 되는 순간, 3M 길이 호스가 그 거리를 채워줍니다.",
    transitionToNext: "",
    ...overrides,
  };
}

const profile: ProductProfile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터",
  model: null,
  material: "스테인리스",
  features: ["3M 길이"],
  specifications: {},
  usage: "베란다 청소",
  advantages: [],
  warnings: [],
  keywords: [],
  confidence: 0.9,
};

const image: StudioSelectedImage = {
  imageId: "img-1",
  category: "USAGE_SCENE",
  groupVersion: 1,
  mimeType: "image/jpeg",
  base64: "fake",
};

describe("planAuxiliaryVisuals", () => {
  it("실제 제품 사진이 없고 카피가 충분한 text-only/feature-highlight 섹션만 계획한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section({ sectionId: "s1", productFacts: [] })], // 근거 1개 이하 → text-only
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const specs = planAuxiliaryVisuals(story, assigned, plan);
    expect(specs).toHaveLength(1);
    expect(specs[0].sectionId).toBe("s1");
  });

  it("실제 제품 사진이 이미 배정된 섹션에는 절대 보조 그래픽을 계획하지 않는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section({ sectionId: "s1", imageRole: "USAGE_SCENE" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image }];
    const plan = planStoryDesign(story);
    const specs = planAuxiliaryVisuals(story, assigned, plan);
    expect(specs).toHaveLength(0);
  });

  it("카피가 짧으면(강조할 내용이 빈약하면) 계획하지 않는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section({ sectionId: "s1", productFacts: [], copy: "짧음" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const specs = planAuxiliaryVisuals(story, assigned, plan);
    expect(specs).toHaveLength(0);
  });

  it("한 상세페이지당 최대 2개까지만 계획한다 — 무제한 생성으로 비용이 새지 않게 한다", () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      section({ sectionId: `s${i}`, productFacts: [], copy: "충분히 긴 설명 문구가 여기 들어갑니다 텍스트만으로 구성된 섹션입니다." }),
    );
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections };
    const assigned: AssignedStorySection[] = sections.map((s) => ({ section: s, image: null }));
    const plan = planStoryDesign(story);
    const specs = planAuxiliaryVisuals(story, assigned, plan);
    expect(specs.length).toBeLessThanOrEqual(2);
  });
});

describe("buildAuxiliaryVisualPrompt", () => {
  it("같은 입력이면 항상 같은 프롬프트를 만든다(결정적)", () => {
    const a = buildAuxiliaryVisualPrompt("핵심 메시지", "#334155", "SECTION_BACKDROP");
    const b = buildAuxiliaryVisualPrompt("핵심 메시지", "#334155", "SECTION_BACKDROP");
    expect(a).toBe(b);
  });

  it("제품 형태·구성품·수치·인증을 새로 만들지 말라는 가드레일 문구를 반드시 포함한다", () => {
    const prompt = buildAuxiliaryVisualPrompt("핵심 메시지", "#334155", "SECTION_BACKDROP");
    expect(prompt).toContain("실제 제품의 형태·구성품·소재·색상·수치·인증을 새로 만들거나 암시하지 마세요");
    expect(prompt).toContain("제품 사진이 아니라");
  });

  it("글자·로고·사람·제품 실물을 그리지 말라고 명시한다", () => {
    const prompt = buildAuxiliaryVisualPrompt("핵심 메시지", "#334155", "SECTION_BACKDROP");
    expect(prompt).toContain("글자·로고·상표를 그리지 마세요");
    expect(prompt).toContain("사람·제품 실물을 그리지 마세요");
  });
});

describe("dryRunAuxiliaryVisualPlan — 실제 Gemini 호출 없이 계획만 확인", () => {
  it("계획이 없으면 이유와 함께 0건을 보고한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section({ sectionId: "s1", imageRole: "USAGE_SCENE" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image }];
    const plan = planStoryDesign(story);
    const result = dryRunAuxiliaryVisualPlan(story, assigned, plan, profile);
    expect(result.plannedCount).toBe(0);
    expect(result.skippedReason).toBeTruthy();
  });

  it("계획이 있으면 실제 API를 호출하지 않고도 무엇을 요청하게 될지 미리 보여준다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section({ sectionId: "s1", productFacts: [] })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const result = dryRunAuxiliaryVisualPlan(story, assigned, plan, profile);
    expect(result.plannedCount).toBe(1);
    expect(result.specs[0].promptText).toContain("제품 사진이 아니라");
    expect(result.skippedReason).toBeNull();
  });
});
