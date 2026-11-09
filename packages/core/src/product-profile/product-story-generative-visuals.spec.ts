import { planStoryDesign } from "./product-story-design";
import {
  buildGenerativeHeroMotifPrompt,
  buildGenerativeIconPrompt,
  planGenerativeHeroMotif,
  planGenerativeIcons,
} from "./product-story-generative-visuals";
import type { ProductStory, ProductStorySection } from "./product-story";

function section(overrides: Partial<ProductStorySection> = {}): ProductStorySection {
  return {
    sectionId: "s1",
    purpose: "문제 제기",
    customerContext: "베란다 청소가 귀찮다",
    productFacts: ["3M 길이 호스"],
    keyMessage: "긴 호스로 구석까지 닿는다",
    imageRole: "NONE",
    imageFactsShown: [],
    copy: "베란다 끝까지 손이 닿지 않아 청소를 미루게 되는 순간, 3M 길이 호스가 그 거리를 채워줍니다.",
    transitionToNext: "다음 섹션에서 구조를 설명한다",
    ...overrides,
  };
}

function story(sections: ProductStorySection[]): ProductStory {
  return { productName: "베란다 호스", narrativeSummary: "베란다 청소가 번거로운 상황을 설명한다", sections };
}

describe("planGenerativeIcons", () => {
  it("이번 Story가 실제로 쓰는 아이콘만 계획한다 — 아이콘이 없는(none) 섹션은 계획에서 빠진다", () => {
    const s = story([section({ purpose: "문제 제기", imageRole: "NONE" })]); // problem-empathy → icon: none
    const plan = planStoryDesign(s);
    expect(planGenerativeIcons(plan)).toEqual([]);
  });

  it("여러 섹션이 같은 아이콘을 쓰면 한 번만 계획한다(중복 제거)", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "주의사항", productFacts: ["A/S"] }),
      section({ sectionId: "s2", purpose: "보증 안내", productFacts: ["1년 보증"] }),
    ]);
    const plan = planStoryDesign(s);
    // 둘 다 notice → warning 아이콘
    expect(plan.sections[0].icon).toBe("warning");
    expect(plan.sections[1].icon).toBe("warning");
    const specs = planGenerativeIcons(plan);
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe("warning");
  });

  it("서로 다른 아이콘을 쓰는 섹션이 여러 개면 각각 계획한다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "주의사항", productFacts: ["A/S"] }), // warning
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }), // spec
    ]);
    const plan = planStoryDesign(s);
    const specs = planGenerativeIcons(plan);
    expect(specs.map((spec) => spec.id).sort()).toEqual(["spec", "warning"]);
  });

  it("생성할 프롬프트는 제품 실물·글자를 그리지 말라는 금지 지시를 포함한다", () => {
    const s = story([section({ purpose: "주의사항", productFacts: ["A/S"] })]);
    const plan = planStoryDesign(s);
    const specs = planGenerativeIcons(plan);
    expect(specs[0].promptText).toContain("글자");
    expect(specs[0].promptText).toContain("제품 사진이 아니라");
  });

  it("buildGenerativeIconPrompt는 순수 함수다 — 같은 입력이면 같은 문장", () => {
    const a = buildGenerativeIconPrompt("spec", "#38bdf8");
    const b = buildGenerativeIconPrompt("spec", "#38bdf8");
    expect(a).toBe(b);
  });
});

describe("planGenerativeHeroMotif", () => {
  it("섹션이 하나도 없으면 계획하지 않는다", () => {
    expect(planGenerativeHeroMotif(story([]))).toBeNull();
  });

  it("섹션이 하나라도 있으면 Hero 모티프 1개를 계획한다", () => {
    const spec = planGenerativeHeroMotif(story([section()]));
    expect(spec).not.toBeNull();
    expect(spec?.id).toBe("hero-motif");
  });

  it("생성할 프롬프트는 글자를 그리지 말라는 금지 지시와 narrativeSummary를 포함한다", () => {
    const spec = planGenerativeHeroMotif(story([section()]));
    expect(spec?.promptText).toContain("글자");
    expect(spec?.promptText).toContain("베란다 청소가 번거로운 상황을 설명한다");
  });

  it("buildGenerativeHeroMotifPrompt는 순수 함수다 — 같은 입력이면 같은 문장", () => {
    const a = buildGenerativeHeroMotifPrompt("요약 A");
    const b = buildGenerativeHeroMotifPrompt("요약 A");
    expect(a).toBe(b);
  });
});
