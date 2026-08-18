import { renderProductStoryHtml, type GenerativeVisualBundle } from "./product-story-html";
import type { AssignedStorySection, ProductStory } from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";
import { planStoryDesign } from "./product-story-design";
import type { AuxiliaryVisualAsset } from "./product-story-auxiliary-visual";
import type { GenerativeVisualAsset } from "./product-story-generative-visuals";

function section(id: string, imageRole: AssignedStorySection["section"]["imageRole"] = "NONE") {
  return {
    sectionId: id,
    purpose: `${id}-purpose`,
    customerContext: "상황",
    productFacts: ["사실"],
    keyMessage: "핵심 메시지",
    imageRole,
    imageFactsShown: imageRole === "NONE" ? [] : ["이미지가 보여주는 사실"],
    copy: `${id} 섹션 본문 내용입니다.`,
    transitionToNext: "다음으로 이어짐",
  };
}

const image: StudioSelectedImage = {
  imageId: "img-1",
  category: "USAGE_SCENE",
  groupVersion: 1,
  mimeType: "image/jpeg",
  base64: Buffer.from("fake-bytes").toString("base64"),
};

describe("renderProductStoryHtml", () => {
  it("이미지가 배정된 섹션은 사진과 카피를 함께 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image }];
    const { html, css } = renderProductStoryHtml(story, assigned);
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("s1 섹션 본문 내용입니다.");
    expect(html).toContain('data-section-id="s1"');
    expect(css).toContain(".pde-page--story");
  });

  it("이미지가 없는(NONE) 섹션은 텍스트 전용 블록으로 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain("pde-story-figure--text-only");
    expect(html).not.toContain("<img");
  });

  it("사람이 만들지 않은 텍스트를 HTML에 그대로 심지 않고 이스케이프한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "<script>alert(1)</script>",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("배정된 이미지 중 첫 번째를 Hero 배경으로 쓴다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE"), section("s2", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image: null },
      { section: story.sections[1], image },
    ];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain("pde-hero--photo");
  });

  it("Hero로 쓰인 이미지는 원래 배정된 섹션 본문에서 다시 그리지 않는다 — 상단/본문 이미지 중복 금지(T1-118)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "USAGE_SCENE"), section("s2", "NONE")],
    };
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image },
      { section: story.sections[1], image: null },
    ];
    const { html } = renderProductStoryHtml(story, assigned);
    // Hero(pde-hero-media)에는 한 번만 나오고, 본문(pde-story-figure)에는 다시 나오면 안 된다
    expect(html).toContain(`<div class="pde-hero-media">`);
    expect(html.match(new RegExp(`<img src="data:image/jpeg;base64,${image.base64}"`, "g"))).toHaveLength(1);
    // 본문 텍스트는 그대로 유지된다(사진만 생략, 카피는 유지)
    expect(html).toContain("s1 섹션 본문 내용입니다.");
  });

  it("배정된 이미지가 하나도 없으면 그라디언트 Hero로 대체한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("pde-hero--photo");
    expect(html).toContain("<h1>베란다 호스</h1>");
  });

  it("Hero는 왼쪽 텍스트/오른쪽 대형 이미지 split 마크업(pde-hero-grid)으로 렌더링한다(T1-147)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain('<div class="pde-hero-grid">');
    expect(html).toContain('<div class="pde-hero-media">');
    expect(html).toContain('<div class="pde-hero-text">');
  });

  it("Hero 텍스트 영역에 의미 있는 아이콘이 있는 섹션 최대 4개를 핵심 기능 행으로 보여준다(T1-147)", () => {
    const withFacts = (id: string, role: AssignedStorySection["section"]["imageRole"]) => ({
      ...section(id, role),
      productFacts: ["사실1", "사실2"],
    });
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        section("hero", "USAGE_SCENE"),
        withFacts("f1", "NONE"),
        withFacts("f2", "NONE"),
        withFacts("f3", "NONE"),
        withFacts("f4", "NONE"),
        withFacts("f5", "NONE"),
      ],
    };
    const assigned: AssignedStorySection[] = story.sections.map((s) => ({
      section: s,
      image: s.sectionId === "hero" ? image : null,
    }));
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain("pde-hero-features");
    const chipCount = (html.match(/pde-hero-feature"/g) ?? []).length;
    expect(chipCount).toBeLessThanOrEqual(4);
    expect(chipCount).toBeGreaterThan(0);
  });
});

describe("renderProductStoryHtml — 타이포그래피·아이콘·강조색·보조 그래픽 (T1-112)", () => {
  it("CSS에 Design Plan의 역할별 글꼴 스택을 변수로 심는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { css } = renderProductStoryHtml(story, assigned, plan);
    expect(css).toContain(`--pde-font-display: ${plan.typography.display}`);
    expect(css).toContain(`--pde-font-body: ${plan.typography.body}`);
  });

  it("의미 있는 아이콘이 배정된 섹션(주의사항)은 실제 아이콘 SVG와 data-icon 속성을 함께 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "notice",
          purpose: "주의사항",
          customerContext: "구매 전 확인",
          productFacts: ["A/S 1년"],
          keyMessage: "보증 안내",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "A/S는 1년입니다.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(plan.sections[0].icon).toBe("warning");
    expect(html).toContain('data-icon="warning"');
    expect(html).toContain("pde-story-icon");
    expect(html).toContain(`--pde-story-accent:${plan.sections[0].accentColor}`);
  });

  it("아이콘이 없는 레이아웃(problem-empathy)에는 아이콘 배지를 그리지 않는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "problem",
          purpose: "문제 제기",
          customerContext: "베란다 청소가 귀찮다",
          productFacts: [],
          keyMessage: "핵심",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "베란다 청소가 매번 번거로웠던 경험, 다들 있으실 겁니다.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(plan.sections[0].icon).toBe("none");
    expect(html).not.toContain("pde-story-icon");
  });

  it("실제 제품 사진이 없는 섹션에 보조 그래픽을 넘기면 gemini-auxiliary 출처로 표시하며 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const aux: AuxiliaryVisualAsset[] = [
      { sectionId: "s1", role: "SECTION_BACKDROP", source: "gemini-auxiliary", mimeType: "image/png", base64: "abc" },
    ];
    const { html } = renderProductStoryHtml(story, assigned, undefined, aux);
    expect(html).toContain('data-visual-source="gemini-auxiliary"');
    expect(html).toContain("data:image/png;base64,abc");
  });

  it("image-feature 레이아웃은 카피와 함께 productFacts를 강조 칩으로 렌더링한다 — image-text에서 근거가 사라지던 문제를 막는다(T1-118)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "usage",
          purpose: "실제 사용 장면",
          customerContext: "상황",
          productFacts: ["3M 길이 호스"],
          keyMessage: "핵심",
          imageRole: "USAGE_SCENE",
          imageFactsShown: ["장면"],
          copy: "베란다에서 실제로 이 호스를 펼쳐 사용하는 모습입니다. 손잡이를 쥐고 원하는 방향으로 물을 뿌리면 구석까지 닿아 청소가 훨씬 수월해집니다.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(plan.sections[0].layout).toBe("image-feature");
    expect(html).toContain('data-layout="image-feature"');
    expect(html).toContain("<li>3M 길이 호스</li>");
  });

  it("components-grid 레이아웃은 구성품 근거를 번호가 붙은 카드 그리드로 렌더링한다(T1-138)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 확인",
          customerContext: "상황",
          productFacts: ["고무 패킹 2개", "스테인리스 호스"],
          keyMessage: "박스 안 구성품",
          imageRole: "COMPONENTS",
          imageFactsShown: ["구성품 전체"],
          copy: "박스를 열면 이 구성품들이 들어 있습니다.",
          transitionToNext: "",
        },
      ],
    };
    const componentsImage: StudioSelectedImage = { ...image, category: "COMPONENTS" };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: componentsImage }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(plan.sections[0].layout).toBe("components-grid");
    expect(html).toContain('data-layout="components-grid"');
    expect(html).toContain("pde-story-components-grid");
    expect(html).toContain("<span class=\"pde-story-components-index\">1</span>");
    expect(html).toContain("고무 패킹 2개");
  });

  it("섹션이 3개 이상이면 마지막 섹션을 closing 레이아웃(감성적 마무리)으로 렌더링한다(T1-118)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE"), section("s2", "NONE"), section("s3", "NONE")],
    };
    story.sections[2].purpose = "제품의 가치를 정리";
    story.sections[2].keyMessage = "이제 청소가 편해집니다";
    const assigned: AssignedStorySection[] = story.sections.map((s) => ({ section: s, image: null }));
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(plan.sections[2].layout).toBe("closing");
    expect(html).toContain('data-layout="closing"');
    expect(html).toContain("pde-story-closing-message");
  });

  it("실제 제품 사진이 있는 섹션에는 보조 그래픽을 절대 그리지 않는다 — 제품 사진을 대체하지 않는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image }];
    const aux: AuxiliaryVisualAsset[] = [
      { sectionId: "s1", role: "SECTION_BACKDROP", source: "gemini-auxiliary", mimeType: "image/png", base64: "abc" },
    ];
    const { html } = renderProductStoryHtml(story, assigned, undefined, aux);
    expect(html).not.toContain("gemini-auxiliary");
  });
});

describe("renderProductStoryHtml — 헤드라인+짧은 카피 구조 (T1-126)", () => {
  it("image-text 레이아웃도 keyMessage를 헤드라인으로 함께 렌더링한다 — 사진 아래 카피 한 줄만 남지 않는다", () => {
    // 두 섹션 모두 이미지가 있어야 한다 — 유일한 이미지는 Hero로 쓰이며
    // 본문에서는 중복 표시가 생략되므로(T1-118), split 레이아웃 자체를
    // 확인하려면 검사 대상 섹션의 이미지가 Hero로 흡수되지 않아야 한다.
    const otherImage: StudioSelectedImage = { ...image, imageId: "img-hero" };
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        section("hero-section", "USAGE_SCENE"),
        {
          sectionId: "usage",
          purpose: "실제 사용 장면",
          customerContext: "상황",
          productFacts: [],
          keyMessage: "3M, 구석까지 한 번에",
          imageRole: "USAGE_SCENE",
          imageFactsShown: ["장면"],
          copy: "손잡이를 쥐고 뿌리면 끝까지 닿는다.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image: otherImage },
      { section: story.sections[1], image },
    ];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(plan.sections[1].layout).toBe("image-text");
    expect(html).toContain('class="pde-story-figure pde-story-figure--split"');
    expect(html).toContain('<p class="pde-story-key-message">');
    expect(html).toContain("3M, 구석까지 한 번에");
  });

  it("이미지가 없는 text-only 섹션도 keyMessage를 헤드라인으로 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain('<p class="pde-story-key-message">');
    expect(html).toContain("핵심 메시지");
  });

  it("spec-panel의 '라벨: 값' fact는 값/라벨을 분리해 큰 숫자 마크업으로 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "spec",
          purpose: "제품 사양",
          customerContext: "상황",
          productFacts: ["길이: 3M", "재질: 스테인리스"],
          keyMessage: "핵심 사양",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "필요한 정보만 정확하게.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain('<span class="pde-story-spec-value">3M</span><span class="pde-story-spec-label">길이</span>');
  });

  it("spec-panel의 여러 단어로 된 값은 --long 수정자 클래스를 붙여 과도하게 커지지 않게 한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 확인",
          customerContext: "상황",
          productFacts: ["스테인리스 호스"],
          keyMessage: "구성품",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "연결부 패킹이 기본으로 들어 있다.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain('class="pde-story-spec-value pde-story-spec-value--long"');
  });
});

describe("renderProductStoryHtml — 생성형 아이콘/kicker/Hero 모티프 (T1-142)", () => {
  const noticeSection = {
    sectionId: "notice",
    purpose: "주의사항",
    customerContext: "구매 전 확인",
    productFacts: ["A/S 1년"],
    keyMessage: "보증 안내",
    imageRole: "NONE" as const,
    imageFactsShown: [],
    copy: "A/S는 1년입니다.",
    transitionToNext: "",
  };

  it("생성형 아이콘 자산이 없으면 기존 인라인 SVG로 렌더링한다(graceful fallback)", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).toContain('data-icon-source="fallback-svg"');
    expect(html).not.toContain('data-icon-source="gemini-generative-design"');
  });

  it("생성형 아이콘 자산이 있으면 인라인 SVG 대신 생성 이미지를 렌더링한다", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    expect(plan.sections[0].icon).toBe("warning");
    const warningIcon: GenerativeVisualAsset = {
      kind: "ICON",
      id: "warning",
      source: "gemini-generative-design",
      mimeType: "image/png",
      base64: "d2FybmluZy1pY29u",
    };
    const bundle: GenerativeVisualBundle = { icons: { warning: warningIcon }, heroMotif: null };
    const { html } = renderProductStoryHtml(story, assigned, plan, undefined, bundle);
    expect(html).toContain('data-icon-source="gemini-generative-design"');
    expect(html).toContain("d2FybmluZy1pY29u");
  });

  it("레이아웃 의미를 나타내는 kicker 라벨을 렌더링한다(notice → CAUTION)", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).toContain('<span class="pde-story-kicker">CAUTION</span>');
  });

  it("근거 없는 레이아웃(problem-empathy)에는 kicker를 렌더링하지 않는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "problem",
          purpose: "문제 제기",
          customerContext: "상황",
          productFacts: [],
          keyMessage: "핵심",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "베란다 청소가 매번 번거로웠던 경험, 다들 있으실 겁니다.",
          transitionToNext: "",
        },
      ],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).not.toContain("pde-story-kicker");
  });

  it("Hero 모티프가 있으면 Hero 배경과 Story 요약 밴드 두 곳에 같은 자산을 재사용한다", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const heroMotif: GenerativeVisualAsset = {
      kind: "HERO_MOTIF",
      id: "hero-motif",
      source: "gemini-generative-design",
      mimeType: "image/png",
      base64: "aGVyby1tb3RpZg==",
    };
    const bundle: GenerativeVisualBundle = { icons: {}, heroMotif };
    const { html } = renderProductStoryHtml(story, assigned, undefined, undefined, bundle);
    expect(html.split("aGVyby1tb3RpZg==").length - 1).toBe(2);
    expect(html).toContain("pde-hero-motif");
    expect(html).toContain("pde-story-summary-motif");
  });

  it("Hero 모티프가 없으면 아무것도 렌더링하지 않는다", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("pde-hero-motif");
    expect(html).not.toContain("pde-story-summary-motif");
  });

  it("gallery에 이미지가 있으면 대표 이미지 아래 추가 썸네일 스트립을 렌더링한다(T1-144)", () => {
    // 섹션을 2개 두어 components 섹션의 이미지가 Hero로 뽑히지 않게 한다
    // (Hero는 이미지가 배정된 첫 섹션을 쓰고, 그 섹션 본문에서는 중복
    // 방지를 위해 대표 사진과 갤러리를 함께 생략한다 — 아래 별도 테스트).
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("intro", "HERO"), section("components", "COMPONENTS")],
    };
    const gallery: StudioSelectedImage[] = [
      { ...image, imageId: "c2", category: "COMPONENTS", source: "real" },
      { ...image, imageId: "c3", category: "COMPONENTS", source: "real" },
    ];
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image: { ...image, imageId: "hero-1", category: "HERO" } },
      { section: story.sections[1], image: { ...image, imageId: "c1", category: "COMPONENTS", source: "real" }, gallery },
    ];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).toContain("pde-story-gallery-strip");
    expect(html).toContain('data-asset-id="c2"');
    expect(html).toContain('data-asset-id="c3"');
    expect(html).toContain('data-asset-category="COMPONENTS"');
    expect(html).toContain('data-asset-section-id="components"');
  });

  it("대표 이미지가 Hero 중복으로 숨겨져도 갤러리는 그대로 보여준다(T1-147) — 갤러리 사진은 Hero와 다른 실제 사진이라 이미지 밀도를 위해 유지한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("components", "COMPONENTS")],
    };
    const heroImage: StudioSelectedImage = { ...image, imageId: "c1", category: "COMPONENTS", source: "real" };
    const gallery: StudioSelectedImage[] = [{ ...image, imageId: "c2", category: "COMPONENTS", source: "real" }];
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: heroImage, gallery }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    // c1이 Hero로도 쓰이므로 본문에서는 대표 사진 자체가 숨겨지지만,
    // c2(갤러리)는 c1과 다른 실제 사진이므로 그대로 보여준다.
    expect(html).toContain("pde-story-gallery-strip");
    expect(html).toContain('data-asset-id="c2"');
  });

  it("별도 '제품 더 보기' 회수 섹션을 렌더링하지 않는다(T1-147) — 남은 이미지는 assignStoryImages 단계에서 섹션 갤러리로 합쳐진다", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("pde-media-gallery");
    expect(html).not.toContain("제품 더 보기");
  });
});
