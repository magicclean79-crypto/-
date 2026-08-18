import {
  countDistinctLayouts,
  dropRedundantNoticeSections,
  hasMonotonousLayoutRun,
  hasNoVisualVariation,
  planStoryDesign,
} from "./product-story-design";
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
  return { productName: "베란다 호스", narrativeSummary: "요약", sections };
}

describe("planStoryDesign", () => {
  it("이미지 없이 문제 제기 표현이 있으면 problem-empathy로 분류한다", () => {
    const s = story([section({ purpose: "문제 제기", imageRole: "NONE" })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("problem-empathy");
  });

  it("주의·보증 표현이 있으면 notice로 분류한다(다른 조건보다 우선)", () => {
    const s = story([
      section({ purpose: "구매 전 주의사항", keyMessage: "보증 안내", productFacts: ["A/S 1년"] }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("notice");
  });

  it("사양/구성 표현 + 근거가 있으면 spec-panel로 분류한다", () => {
    const s = story([section({ purpose: "제품 사양", productFacts: ["길이 3M", "재질 스테인리스"] })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("spec-panel");
  });

  it("사용 순서 표현 + 근거 2개 이상이면 step-by-step으로 분류한다", () => {
    const s = story([
      section({ purpose: "사용 방법", productFacts: ["손잡이를 쥔다", "방향을 조절한다"] }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("step-by-step");
  });

  it("이미지 있고 클로즈업/디테일 의도가 명시되면 detail-callout으로 분류한다", () => {
    const s = story([section({ purpose: "디테일", imageRole: "DETAIL", copy: "분사기 손잡이 클로즈업" })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("detail-callout");
  });

  it("카피가 짧아도 클로즈업/디테일 표현이 없으면 detail-callout으로 분류하지 않는다 — 헤드라인+짧은 카피 원칙(T1-126) 아래에서는 카피 길이가 더 이상 신호가 아니다", () => {
    const s = story([
      section({ purpose: "실제 사용 장면", imageRole: "USAGE_SCENE", productFacts: [], copy: "손잡이를 쥐고 뿌리면 끝까지 닿는다." }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).not.toBe("detail-callout");
    expect(plan.sections[0].layout).toBe("image-text");
  });

  it("이미지 있고 카피가 길고 근거가 없으면 image-text로 분류한다", () => {
    const s = story([
      section({
        purpose: "실제 사용 장면",
        imageRole: "USAGE_SCENE",
        productFacts: [],
        copy: "베란다에서 실제로 이 호스를 펼쳐 사용하는 모습입니다. 손잡이를 쥐고 원하는 방향으로 물을 뿌리면 구석까지 닿아 청소가 훨씬 수월해집니다.",
      }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("image-text");
  });

  it("이미지 있고 카피가 길면서 근거도 있으면 image-feature로 분류한다 — 근거가 image-text에서 조용히 사라지는 문제를 막는다(T1-118)", () => {
    const s = story([
      section({
        purpose: "실제 사용 장면",
        imageRole: "USAGE_SCENE",
        productFacts: ["3M 길이 호스"],
        copy: "베란다에서 실제로 이 호스를 펼쳐 사용하는 모습입니다. 손잡이를 쥐고 원하는 방향으로 물을 뿌리면 구석까지 닿아 청소가 훨씬 수월해집니다.",
      }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("image-feature");
  });

  it("이미지 카테고리가 DETAIL이면 purpose에 '디테일' 같은 단어가 없어도 detail-callout으로 분류한다 — Image Studio가 이미 클로즈업으로 검증한 사진이다(T1-138)", () => {
    const s = story([
      section({
        purpose: "제품의 세부 사항 설명",
        keyMessage: "핵심 부품 확인",
        imageRole: "DETAIL",
        productFacts: ["스테인리스 표면 마감"],
        copy: "표면 처리가 매끄럽게 되어 있습니다.",
      }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("detail-callout");
  });

  it("이미지 카테고리가 COMPONENTS이고 근거가 있으면 components-grid로 분류한다", () => {
    const s = story([
      section({
        purpose: "구성품 확인",
        keyMessage: "박스 안 구성품",
        imageRole: "COMPONENTS",
        productFacts: ["고무 패킹 2개", "스테인리스 호스"],
        copy: "박스를 열면 이 구성품들이 들어 있습니다.",
      }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("components-grid");
    expect(plan.sections[0].icon).toBe("box");
  });

  it("이미지 카테고리가 COMPONENTS여도 근거가 없으면 components-grid로 분류하지 않는다 — 지어낼 구성품이 없다", () => {
    const s = story([
      section({
        purpose: "구성품 확인",
        keyMessage: "박스 안 구성품",
        imageRole: "COMPONENTS",
        productFacts: [],
        copy: "박스를 열면 구성품이 들어 있습니다.",
      }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).not.toBe("components-grid");
  });

  it("이미지 없고 근거가 1개 이하면 text-only로 분류한다", () => {
    const s = story([
      section({ purpose: "마무리", keyMessage: "구매 전 확인", productFacts: [], copy: "감사합니다." }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].layout).toBe("text-only");
  });

  it("섹션이 3개 이상이면 마지막 섹션은 감성적 마무리(closing)로 분류한다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "문제 제기", imageRole: "NONE" }),
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }),
      section({ sectionId: "s3", purpose: "제품의 가치를 정리", keyMessage: "이제 청소가 편해집니다" }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[2].layout).toBe("closing");
    expect(plan.sections[2].icon).toBe("none");
  });

  it("섹션이 2개 이하면 마지막 섹션도 closing으로 강제 분리하지 않는다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "문제 제기", imageRole: "NONE" }),
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[1].layout).not.toBe("closing");
  });

  it("마지막 섹션이라도 주의사항이면 여전히 notice로 분류한다(사실 전달이 감성 마무리보다 우선)", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "문제 제기", imageRole: "NONE" }),
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }),
      section({ sectionId: "s3", purpose: "구매 전 주의사항", keyMessage: "보증 안내", productFacts: ["A/S 1년"] }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[2].layout).toBe("notice");
  });

  it("실제 비교 데이터가 없으므로 comparison류 레이아웃은 절대 나오지 않는다", () => {
    const s = story([
      section({ purpose: "비교", keyMessage: "타사 대비 장점" }),
      section({ purpose: "경쟁 제품과 비교", keyMessage: "비교 우위" }),
    ]);
    const plan = planStoryDesign(s);
    for (const spec of plan.sections) {
      expect(spec.layout).not.toMatch(/comparison/);
    }
  });
});

describe("countDistinctLayouts / hasMonotonousLayoutRun", () => {
  it("서로 다른 성격의 섹션이면 레이아웃 종류가 2개 이상이다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "문제 제기", imageRole: "NONE" }),
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }),
      section({ sectionId: "s3", purpose: "실제 사용 장면", imageRole: "USAGE_SCENE", copy: "짧음" }),
    ]);
    const plan = planStoryDesign(s);
    expect(countDistinctLayouts(plan)).toBeGreaterThanOrEqual(2);
    expect(hasMonotonousLayoutRun(plan)).toBe(false);
  });

  it("같은 레이아웃이 3개 이상 연속되면 단조로움으로 감지한다", () => {
    // 마지막 섹션(4번째)은 항상 closing으로 분리되므로(T1-118), 연속 3회
    // 반복은 그 앞의 s1~s3에서 확인한다.
    const s = story([
      section({ sectionId: "s1", purpose: "일반", imageRole: "DETAIL", copy: "짧은 캡션 1" }),
      section({ sectionId: "s2", purpose: "일반", imageRole: "DETAIL", copy: "짧은 캡션 2" }),
      section({ sectionId: "s3", purpose: "일반", imageRole: "DETAIL", copy: "짧은 캡션 3" }),
      section({ sectionId: "s4", purpose: "마무리", keyMessage: "정리", productFacts: [], copy: "감사합니다." }),
    ]);
    const plan = planStoryDesign(s);
    expect(hasMonotonousLayoutRun(plan)).toBe(true);
  });
});

describe("planStoryDesign — 타이포그래피·아이콘·강조색 (T1-112)", () => {
  it("Design Plan은 역할별 글꼴 스택(typography)을 포함한다", () => {
    const plan = planStoryDesign(story([section()]));
    expect(plan.typography.display).toBeTruthy();
    expect(plan.typography.body).toBeTruthy();
    expect(plan.typography.emphasis).toBeTruthy();
    expect(plan.typography.numeric).toBeTruthy();
  });

  it("숫자·영문 kicker 전용 서체(accent/numeric)는 한글 Display 서체와 실제로 다르다(T1-142)", () => {
    const plan = planStoryDesign(story([section()]));
    expect(plan.typography.accent).toBeTruthy();
    expect(plan.typography.accent).not.toBe(plan.typography.display);
    expect(plan.typography.numeric).not.toBe(plan.typography.display);
  });

  it("외부 웹폰트 네트워크 없이도 안전한 시스템 폰트만 쓴다(@font-face·http 없음)", () => {
    const plan = planStoryDesign(story([section()]));
    for (const stack of Object.values(plan.typography)) {
      expect(stack).not.toContain("http");
      expect(stack).not.toContain("@font-face");
    }
  });

  it("notice 레이아웃은 경고 아이콘을 배정받는다 — 장식이 아니라 실제 의미(주의사항)를 나타낸다", () => {
    const s = story([section({ purpose: "주의사항", keyMessage: "보증 안내", productFacts: ["A/S 1년"] })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].icon).toBe("warning");
  });

  it("근거 없는 레이아웃(problem-empathy)에는 아이콘을 붙이지 않는다", () => {
    const s = story([section({ purpose: "문제 제기", imageRole: "NONE" })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].icon).toBe("none");
  });

  it("의미 있는 레이아웃(notice)에는 짧은 영문 kicker 라벨이 배정된다(T1-142)", () => {
    const s = story([section({ purpose: "주의사항", keyMessage: "보증 안내", productFacts: ["A/S 1년"] })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].kicker).toBe("CAUTION");
  });

  it("근거 없는 레이아웃(problem-empathy)에는 kicker도 빈 문자열이다", () => {
    const s = story([section({ purpose: "문제 제기", imageRole: "NONE" })]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].kicker).toBe("");
  });

  it("서로 다른 레이아웃은 서로 다른 강조색을 갖는다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "주의사항", productFacts: ["A/S"] }),
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }),
    ]);
    const plan = planStoryDesign(s);
    expect(plan.sections[0].accentColor).not.toBe(plan.sections[1].accentColor);
  });
});

describe("hasNoVisualVariation", () => {
  it("섹션이 하나면 단조롭다고 보지 않는다", () => {
    const plan = planStoryDesign(story([section()]));
    expect(hasNoVisualVariation(plan)).toBe(false);
  });

  it("서로 다른 성격의 섹션이면 색·아이콘이 달라 단조롭지 않다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "주의사항", productFacts: ["A/S"] }),
      section({ sectionId: "s2", purpose: "제품 사양", productFacts: ["길이 3M", "재질"] }),
    ]);
    expect(hasNoVisualVariation(planStoryDesign(s))).toBe(false);
  });

  it("모든 섹션이 같은 레이아웃이면(=같은 색·아이콘) 단조로움으로 감지한다", () => {
    const s = story([
      section({ sectionId: "s1", purpose: "일반", imageRole: "DETAIL", copy: "짧은 캡션 1" }),
      section({ sectionId: "s2", purpose: "일반", imageRole: "DETAIL", copy: "짧은 캡션 2" }),
    ]);
    expect(hasNoVisualVariation(planStoryDesign(s))).toBe(true);
  });
});

describe("dropRedundantNoticeSections (T1-147)", () => {
  it("주의·보증 표현이 있는 섹션을 제거한다 — 검증된 제품정보 패널이 그 내용을 한 번만 보여준다", () => {
    const s = story([
      section({ sectionId: "problem", purpose: "문제 제기" }),
      section({ sectionId: "notice", purpose: "구매 전 주의사항", keyMessage: "A/S 안내", productFacts: ["A/S 1년"] }),
    ]);
    const result = dropRedundantNoticeSections(s);
    expect(result.sections.map((sec) => sec.sectionId)).toEqual(["problem"]);
  });

  it("주의사항 섹션이 없으면 그대로 반환한다", () => {
    const s = story([section({ sectionId: "problem", purpose: "문제 제기" })]);
    const result = dropRedundantNoticeSections(s);
    expect(result.sections).toHaveLength(1);
  });

  it("모든 섹션이 주의사항이면(극단 상황) 아무것도 지우지 않는다 — 빈 Story를 만들지 않는다", () => {
    const s = story([
      section({ sectionId: "notice", purpose: "구매 전 주의사항", keyMessage: "A/S 안내", productFacts: ["A/S 1년"] }),
    ]);
    const result = dropRedundantNoticeSections(s);
    expect(result.sections).toHaveLength(1);
  });
});
