import type { ProductProfile } from "@acos/shared";
import { scoreProductStory, validateProductStory } from "./product-story-quality";
import type { AssignedStorySection, ProductStory, ProductStorySection } from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";
import { STORY_TYPOGRAPHY, planStoryDesign, type StoryDesignPlan } from "./product-story-design";
import { renderProductStoryHtml } from "./product-story-html";

const profile: ProductProfile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터",
  model: "SJ-100",
  material: "ABS, PVC, 스테인리스",
  features: ["분사기 손잡이", "3M 길이 호스"],
  specifications: { 길이: "3M", 재질: "스테인리스" },
  usage: "베란다에서 물을 뿌려 청소할 때 사용",
  advantages: ["3M 길이로 넓은 범위 청소 가능"],
  warnings: [],
  keywords: ["호스"],
  confidence: 0.9,
};

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

function image(id: string): StudioSelectedImage {
  return { imageId: id, category: "DETAIL", groupVersion: 1, mimeType: "image/jpeg", base64: `fake-${id}` };
}

describe("validateProductStory", () => {
  it("사실에 근거하고 구조가 온전한 Story는 ok: true", () => {
    const story: ProductStory = {
      productName: profile.productName,
      narrativeSummary: "베란다 청소 상황과 호스 길이의 관계를 설명한다",
      sections: [section({ sectionId: "s1", transitionToNext: "" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.ok).toBe(true);
  });

  it("'키: 값' 형태로 적은 근거(예: '원산지: 한국')는 specifications에 있으면 근거로 인정한다 (T1-94 실측 회귀)", () => {
    const withOrigin: ProductProfile = { ...profile, specifications: { ...profile.specifications, 원산지: "한국" } };
    const story: ProductStory = {
      productName: withOrigin.productName,
      narrativeSummary: "요약",
      sections: [section({ productFacts: ["원산지: 한국"], transitionToNext: "" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const result = validateProductStory(story, assigned, withOrigin);
    expect(result.issues.some((i) => i.code === "ungrounded-fact")).toBe(false);
  });

  it("Product Profile에 없는 사실을 근거로 들면 ungrounded-fact를 낸다", () => {
    const story: ProductStory = {
      productName: profile.productName,
      narrativeSummary: "요약",
      sections: [section({ productFacts: ["10년 무상 A/S 보증"], transitionToNext: "" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "ungrounded-fact")).toBe(true);
  });

  it("'최고의 제품'류 빈 수식어가 있으면 generic-copy를 낸다", () => {
    const story: ProductStory = {
      productName: profile.productName,
      narrativeSummary: "요약",
      sections: [section({ copy: "이것은 최고의 제품입니다.", transitionToNext: "" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "generic-copy")).toBe(true);
  });

  it("Product Profile에 근거 없는 '특허'·'1위' 표현은 unverified-claim을 낸다", () => {
    const story: ProductStory = {
      productName: profile.productName,
      narrativeSummary: "요약",
      sections: [section({ copy: "특허받은 업계 1위 호스입니다.", transitionToNext: "" })],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unverified-claim")).toBe(true);
  });

  it("같은 이미지가 두 섹션에 배정되면 duplicate-image를 낸다", () => {
    const s1 = section({ sectionId: "s1", imageRole: "DETAIL", imageFactsShown: ["f"] });
    const s2 = section({ sectionId: "s2", imageRole: "DETAIL", imageFactsShown: ["f"], transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1, s2] };
    const sharedImage = image("dup");
    const assigned: AssignedStorySection[] = [
      { section: s1, image: sharedImage },
      { section: s2, image: sharedImage },
    ];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "duplicate-image")).toBe(true);
  });

  it("사진만 있고 설명이 사실상 없는 섹션이 연속되면 photo-dump-sequence를 낸다", () => {
    const s1 = section({ sectionId: "s1", imageRole: "DETAIL", imageFactsShown: ["f"], copy: "." });
    const s2 = section({
      sectionId: "s2",
      imageRole: "DETAIL",
      imageFactsShown: ["f"],
      copy: ".",
      transitionToNext: "",
    });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1, s2] };
    const assigned: AssignedStorySection[] = [
      { section: s1, image: image("a") },
      { section: s2, image: image("b") },
    ];
    const result = validateProductStory(story, assigned, profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "photo-dump-sequence")).toBe(true);
  });

  it("마지막이 아닌 섹션에 transitionToNext가 비어 있으면 no-transition을 낸다", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const s2 = section({ sectionId: "s2", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1, s2] };
    const assigned: AssignedStorySection[] = [
      { section: s1, image: null },
      { section: s2, image: null },
    ];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "no-transition" && i.sectionId === "s1")).toBe(true);
  });

  it("imageRole을 요구했지만 실제 배정된 이미지가 없으면 image-role-without-image를 낸다", () => {
    const s1 = section({ sectionId: "s1", imageRole: "COMPONENTS", imageFactsShown: ["f"], transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "image-role-without-image")).toBe(true);
  });

  it("사용자 요구사항 단어가 Story 어디에도 없으면 user-requirement-not-reflected 경고를 낸다(ok는 막지 않음)", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile, "캠핑 감성으로 만들어주세요");
    const issue = result.issues.find((i) => i.code === "user-requirement-not-reflected");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warn");
  });

  it("사용자 요구사항 단어가 Story에 반영되어 있으면 경고를 내지 않는다", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "", copy: "캠핑장에서도 이 호스를 바로 쓸 수 있습니다." });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile, "캠핑 갈 때도 쓸 수 있는지 강조해주세요");
    expect(result.issues.some((i) => i.code === "user-requirement-not-reflected")).toBe(false);
  });

  it("섹션 카피가 내부 카테고리 라벨과 완전히 같으면 category-label-leak(block)을 낸다 (T1-116)", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "", copy: "사용 장면 이미지" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === "category-label-leak" && i.sectionId === "s1");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("block");
  });

  it("내부 카테고리 라벨이 문장 안에 그대로 섞여 있어도 category-label-leak을 낸다", () => {
    const s1 = section({
      sectionId: "s1",
      transitionToNext: "",
      keyMessage: "이 사진은 구성품 이미지 입니다",
    });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "category-label-leak")).toBe(true);
  });

  it("narrativeSummary가 내부 카테고리 라벨과 같으면 category-label-leak을 낸다", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "정보 설명 이미지", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "category-label-leak")).toBe(true);
  });

  it("일반적인 문구에는 category-label-leak을 내지 않는다 (오탐 방지)", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "category-label-leak")).toBe(false);
  });
});

describe("scoreProductStory", () => {
  it("이슈가 없으면 100점, pass 등급이다", () => {
    const result = scoreProductStory({ ok: true, issues: [] });
    expect(result.score).toBe(100);
    expect(result.grade).toBe("pass");
  });

  it("block 이슈 1건이면 15점 감점된다", () => {
    const result = scoreProductStory({
      ok: false,
      issues: [{ code: "generic-copy", severity: "block", message: "m" }],
    });
    expect(result.score).toBe(85);
    expect(result.grade).toBe("pass");
  });

  it("70점 미만이면 fail 등급이다(성공으로 표시하지 않음)", () => {
    const result = scoreProductStory({
      ok: false,
      issues: [
        { code: "generic-copy", severity: "block", message: "m1" },
        { code: "ungrounded-fact", severity: "block", message: "m2" },
        { code: "unverified-claim", severity: "block", message: "m3" },
      ],
    });
    expect(result.score).toBeLessThan(70);
    expect(result.grade).toBe("fail");
  });

  it("70~79점이면 warn 등급이다", () => {
    const result = scoreProductStory({
      ok: false,
      issues: [
        { code: "generic-copy", severity: "block", message: "m1" },
        { code: "ungrounded-fact", severity: "block", message: "m2" },
      ],
    });
    expect(result.score).toBe(70);
    expect(result.grade).toBe("warn");
  });

  it("같은 레이아웃이 3개 이상 연속되면 추가 감점된다", () => {
    const plan: StoryDesignPlan = {
      sections: [
        { sectionId: "s1", layout: "detail-callout", reason: "", toneIndex: 0, accentColor: "#334155", icon: "info", kicker: "DETAIL" },
        { sectionId: "s2", layout: "detail-callout", reason: "", toneIndex: 1, accentColor: "#334155", icon: "info", kicker: "DETAIL" },
        { sectionId: "s3", layout: "detail-callout", reason: "", toneIndex: 0, accentColor: "#334155", icon: "info", kicker: "DETAIL" },
      ],
      typography: STORY_TYPOGRAPHY,
    };
    const withoutPlan = scoreProductStory({ ok: true, issues: [] });
    const withPlan = scoreProductStory({ ok: true, issues: [] }, plan);
    expect(withPlan.score).toBe(withoutPlan.score - 10);
    expect(withPlan.reasons.length).toBeGreaterThan(0);
  });
});

describe("validateProductStory — Design Plan과 실제 HTML의 일치도 (T1-112)", () => {
  it("designPlan·html을 넘기지 않으면 기존 검사만 동작한다(하위 호환)", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const result = validateProductStory(story, assigned, profile);
    expect(result.issues.some((i) => i.code === "design-html-mismatch")).toBe(false);
  });

  it("렌더링된 실제 파이프라인(renderProductStoryHtml)의 출력은 항상 Design Plan과 일치한다", () => {
    const s1 = section({ sectionId: "s1", purpose: "주의사항", productFacts: ["A/S 1년"], transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const plan = planStoryDesign(story);
    const rendered = renderProductStoryHtml(story, assigned, plan);
    const result = validateProductStory(story, assigned, profile, null, plan, rendered.html);
    expect(result.issues.some((i) => i.code === "design-html-mismatch")).toBe(false);
  });

  it("Design Plan이 배정한 아이콘/강조색이 HTML에 없으면 design-html-mismatch(block)를 낸다 — 렌더러가 Design Plan을 무시한 상태를 잡는다", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1] };
    const assigned: AssignedStorySection[] = [{ section: s1, image: null }];
    const plan: StoryDesignPlan = {
      typography: STORY_TYPOGRAPHY,
      sections: [{ sectionId: "s1", layout: "notice", reason: "", toneIndex: 0, accentColor: "#b45309", icon: "warning", kicker: "CAUTION" }],
    };
    // HTML은 Design Plan을 전혀 반영하지 않은 것처럼 흉내낸다(렌더러 버그 시뮬레이션)
    const fakeHtml = '<section class="pde-story-section" data-section-id="s1"></section>';
    const result = validateProductStory(story, assigned, profile, null, plan, fakeHtml);
    expect(result.ok).toBe(false);
    expect(result.issues.filter((i) => i.code === "design-html-mismatch").length).toBeGreaterThan(0);
  });

  it("모든 섹션의 강조색·아이콘이 동일하면 monotonous-visual-design 경고를 낸다", () => {
    const s1 = section({ sectionId: "s1", transitionToNext: "" });
    const s2 = section({ sectionId: "s2", transitionToNext: "" });
    const story: ProductStory = { productName: profile.productName, narrativeSummary: "요약", sections: [s1, s2] };
    const assigned: AssignedStorySection[] = [
      { section: s1, image: null },
      { section: s2, image: null },
    ];
    const plan: StoryDesignPlan = {
      typography: STORY_TYPOGRAPHY,
      sections: [
        { sectionId: "s1", layout: "text-only", reason: "", toneIndex: 0, accentColor: "#334155", icon: "none", kicker: "" },
        { sectionId: "s2", layout: "problem-empathy", reason: "", toneIndex: 1, accentColor: "#334155", icon: "none", kicker: "" },
      ],
    };
    const result = validateProductStory(story, assigned, profile, null, plan, undefined);
    const issue = result.issues.find((i) => i.code === "monotonous-visual-design");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warn");
  });
});
