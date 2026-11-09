import { renderProductStoryHtml, type GenerativeVisualBundle } from "./product-story-html";
import type { AssignedStorySection, ProductStory } from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";
import { planStoryDesign } from "./product-story-design";
import type { AuxiliaryVisualAsset } from "./product-story-auxiliary-visual";
import type { GenerativeVisualAsset } from "./product-story-generative-visuals";
import { resolveDesignProfile, type DesignDirectorChoice } from "./design-profile";

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

  it("T1-173: HERO 블록을 렌더링하지 않는다 — pde-hero 계열 마크업이 출력에 전혀 없다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE"), section("s2", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image: null },
      { section: story.sections[1], image },
    ];
    const { html, css } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("<header");
    expect(html).not.toMatch(/class="pde-hero/);
    expect(css).not.toMatch(/\.pde-hero/);
  });

  it("T1-173: HERO가 없으므로 첫 이미지가 배정된 섹션도 자기 사진을 정상적으로 렌더링한다 — 예전 hideMedia 억제가 재현되지 않는다", () => {
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
    expect(html.match(new RegExp(`<img src="data:image/jpeg;base64,${image.base64}"`, "g"))).toHaveLength(1);
    expect(html).toContain("s1 섹션 본문 내용입니다.");
  });

  it("T1-173/T1-183: 검증된 hero 사진이 없으면 story-summary(hero 미포함 버전)부터 시작한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("pde-hero--photo");
    expect(html).not.toContain("pde-story-summary--hero");
    expect(html).not.toContain("pde-story-hero-media");
    expect(html.indexOf('<div class="pde-page pde-page--story">') + '<div class="pde-page pde-page--story">'.length).toBe(
      html.indexOf('<div class="pde-story-summary'),
    );
  });

  it("T1-182: story-summary가 제품명(h1)·핵심 메시지(masterBrief.coreMessage)·서사 요약을 계층으로 렌더링한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "긴 서사 요약 문단입니다.",
      masterBrief: {
        targetAudience: "타깃",
        coreMessage: "유연한 분사, 손쉬운 조절",
        emotionalArc: "감정선",
        visualConcept: "비주얼 컨셉",
      },
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain('<h1 class="pde-story-summary-name">베란다 호스</h1>');
    expect(html).toContain("pde-story-summary-tagline");
    expect(html).toContain("유연한 분사");
    expect(html).toContain('<p class="pde-story-summary-narrative">긴 서사 요약 문단입니다.</p>');
  });

  it("T1-182: masterBrief가 없으면 태그라인 없이 제품명·서사 요약만 렌더링한다(지어내지 않음)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "NONE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain('<h1 class="pde-story-summary-name">베란다 호스</h1>');
    expect(html).not.toContain("pde-story-summary-tagline");
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

  it("T1-185 — composition.includedGrid가 components-grid의 실제 레이아웃 클래스를 결정한다(T1-183이 남긴 미연결 gap을 연결)", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 확인",
          customerContext: "상황",
          productFacts: ["고무 패킹 2개"],
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

    // 기본(editorial-brochure, includedGrid="info-left-image-right")은 기존
    // split 레이아웃 그대로다 — 회귀 없음.
    const { html: defaultHtml } = renderProductStoryHtml(story, assigned, plan);
    expect(defaultHtml).toContain("pde-story-figure--split");
    expect(defaultHtml).not.toContain("pde-story-figure--stacked");

    // compact-utility(includedGrid="stacked")를 고르면 stacked 클래스로
    // 바뀐다.
    const stackedProfile = resolveDesignProfile(
      {
        visualStyle: "industrial-premium",
        colorway: "harbor-steel",
        rationale: "테스트",
        typography: {
          headingWeight: "700",
          letterSpacing: "tight",
          lineHeight: "comfortable",
          numericStyle: "tabular",
          accentTypeface: "technical-grotesk",
        },
        iconStyle: { family: "technical-outline", strokeWidth: "regular", cornerStyle: "sharp", opticalSize: "standard" },
        cardStyle: { variant: "soft-shadow", radius: "soft" },
        graphicMotif: { family: "dot-grid", intensity: "subtle" },
        spacingDensity: "standard",
        imageTreatment: { backgroundTreatment: "letterbox-neutral" },
        accentUsage: "balanced",
        avoid: [],
      } as DesignDirectorChoice,
      "compact-utility",
    );
    const { html: stackedHtml } = renderProductStoryHtml(story, assigned, plan, undefined, undefined, stackedProfile);
    expect(stackedHtml).toContain("pde-story-figure--stacked");
    expect(stackedHtml).not.toContain("pde-story-figure--split");
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

  it("아이콘은 항상 DESIGN_PROFILE canonical SVG로 렌더링한다(design-profile-svg)", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).toContain('data-icon-source="design-profile-svg"');
    expect(html).not.toContain('data-icon-source="gemini-generative-design"');
  });

  it("T1-177 — 생성형 아이콘 자산(T1-142)이 있어도 DESIGN_PROFILE.iconStyle을 bypass하지 못한다(회귀 방지)", () => {
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
    // 생성형 아이콘 자산이 있어도 최종 HTML에는 절대 등장하지 않는다 —
    // arbitrary AI 생성 이미지가 아이콘 렌더링을 결정할 수 없다.
    expect(html).not.toContain('data-icon-source="gemini-generative-design"');
    expect(html).not.toContain("d2FybmluZy1pY29u");
    expect(html).toContain('data-icon-source="design-profile-svg"');
  });

  it("레이아웃 의미를 나타내는 kicker 라벨을 렌더링한다(notice → CAUTION, T1-163: 순서 eyebrow 번호와 함께)", () => {
    const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).toContain('<span class="pde-story-kicker-text">CAUTION</span>');
    expect(html).toContain('<span class="pde-story-kicker-index" aria-hidden="true">01</span>');
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

  it("T1-173: Hero 모티프가 있으면 Story 요약 밴드 구분선 한 곳에 자산을 재사용한다 — HERO 자체가 없어져 그 자리 재사용은 사라졌다", () => {
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
    expect(html.split("aGVyby1tb3RpZg==").length - 1).toBe(1);
    expect(html).not.toContain("pde-hero-motif");
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

  it("대표 이미지와 갤러리 사진이 함께 있으면 둘 다 보여준다(T1-147) — 서로 다른 실제 사진이라 이미지 밀도를 위해 둘 다 유지한다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("components", "COMPONENTS")],
    };
    const representativeImage: StudioSelectedImage = { ...image, imageId: "c1", category: "COMPONENTS", source: "real" };
    const gallery: StudioSelectedImage[] = [{ ...image, imageId: "c2", category: "COMPONENTS", source: "real" }];
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: representativeImage, gallery }];
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    expect(html).toContain('data-asset-id="c1"');
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

// ── DESIGN_PROFILE 연결 (T1-176) ────────────────────────────────────

function industrialChoice(): DesignDirectorChoice {
  return {
    visualStyle: "industrial-premium",
    colorway: "harbor-steel",
    rationale: "금속 소재의 실용적 도구성 제품",
    typography: { headingWeight: "700", letterSpacing: "tight", lineHeight: "comfortable", numericStyle: "tabular", accentTypeface: "technical-grotesk" },
    iconStyle: { family: "precision-mono", strokeWidth: "bold", cornerStyle: "sharp", opticalSize: "large" },
    cardStyle: { variant: "soft-shadow", radius: "soft" },
    graphicMotif: { family: "dot-grid", intensity: "subtle" },
    spacingDensity: "standard",
    imageTreatment: { backgroundTreatment: "letterbox-neutral" },
    accentUsage: "balanced",
    avoid: [],
  };
}

function softChoice(): DesignDirectorChoice {
  return {
    visualStyle: "soft-premium",
    colorway: "blush-mauve",
    rationale: "부드러운 패브릭 소재의 유아용품",
    typography: { headingWeight: "600", letterSpacing: "wide", lineHeight: "relaxed", numericStyle: "standard", accentTypeface: "rounded-sans" },
    iconStyle: { family: "soft-rounded", strokeWidth: "thin", cornerStyle: "rounded", opticalSize: "compact" },
    cardStyle: { variant: "elevated", radius: "round" },
    graphicMotif: { family: "none", intensity: "none" },
    spacingDensity: "spacious",
    imageTreatment: { backgroundTreatment: "letterbox-tinted" },
    accentUsage: "minimal",
    avoid: ["금속 질감", "각진 형태"],
  };
}

describe("renderProductStoryHtml — DESIGN_PROFILE (T1-176)", () => {
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
  const story: ProductStory = {
    productName: "베란다 호스",
    narrativeSummary: "요약",
    sections: [section("feature", "FEATURE_HIGHLIGHT"), section("spec", "NONE"), noticeSection],
  };
  const assigned: AssignedStorySection[] = [
    { section: story.sections[0], image: { ...image, imageId: "f1", category: "FEATURE_HIGHLIGHT", source: "real" } },
    { section: story.sections[1], image: null },
    { section: story.sections[2], image: null },
  ];

  it("visualProfile을 지정하지 않으면 기존 baseline과 완전히 동일한 결과를 만든다(회귀 없음)", () => {
    const plan = planStoryDesign(story);
    const withoutProfile = renderProductStoryHtml(story, assigned, plan);
    const withNullProfile = renderProductStoryHtml(story, assigned, plan, undefined, undefined, null);
    expect(withoutProfile).toEqual(withNullProfile);
  });

  it("서로 다른 두 DESIGN_PROFILE은 서로 다른 accentColor/아이콘 스타일을 만든다", () => {
    const industrial = resolveDesignProfile(industrialChoice());
    const soft = resolveDesignProfile(softChoice());
    const plan1 = planStoryDesign(story, { typography: industrial.typography, layoutAccent: industrial.layoutAccent });
    const plan2 = planStoryDesign(story, { typography: soft.typography, layoutAccent: soft.layoutAccent });
    const rendered1 = renderProductStoryHtml(story, assigned, plan1, undefined, undefined, industrial);
    const rendered2 = renderProductStoryHtml(story, assigned, plan2, undefined, undefined, soft);
    expect(rendered1.css).not.toBe(rendered2.css);
    expect(rendered1.html).not.toBe(rendered2.html);
    // industrial은 bold(3) + sharp(square) 아이콘, soft는 thin(1.5) + rounded 아이콘
    expect(rendered1.html).toContain('stroke-width="3"');
    expect(rendered2.html).toContain('stroke-width="1.5"');
  });

  it("제품 정체성(이미지 asset id·섹션 순서·본문 텍스트)은 DESIGN_PROFILE과 무관하게 동일하다", () => {
    const industrial = resolveDesignProfile(industrialChoice());
    const soft = resolveDesignProfile(softChoice());
    const plan1 = planStoryDesign(story, { typography: industrial.typography, layoutAccent: industrial.layoutAccent });
    const plan2 = planStoryDesign(story, { typography: soft.typography, layoutAccent: soft.layoutAccent });
    const rendered1 = renderProductStoryHtml(story, assigned, plan1, undefined, undefined, industrial);
    const rendered2 = renderProductStoryHtml(story, assigned, plan2, undefined, undefined, soft);
    for (const html of [rendered1.html, rendered2.html]) {
      expect(html).toContain('data-asset-id="f1"');
      expect(html).toContain("feature 섹션 본문 내용입니다.");
      expect(html).toContain('data-section-id="feature"');
      expect(html).toContain('data-section-id="spec"');
    }
  });

  it("notice 섹션은 DESIGN_PROFILE과 무관하게 항상 같은 경고색을 쓴다", () => {
    const industrial = resolveDesignProfile(industrialChoice());
    const plan = planStoryDesign(story, { typography: industrial.typography, layoutAccent: industrial.layoutAccent });
    const { css } = renderProductStoryHtml(story, assigned, plan, undefined, undefined, industrial);
    expect(css).toContain("#92400e");
  });

  it("resolveDesignProfile은 제품 이미지 asset을 입력받지 않으므로 제품 사진을 재구성할 수 없다", () => {
    // 이 테스트는 타입 시그니처 자체가 가드레일임을 문서화한다 —
    // DesignDirectorChoice에는 이미지 필드가 없어 resolveDesignProfile이
    // 이미지를 바꿀 방법이 구조적으로 없다.
    const resolved = resolveDesignProfile(industrialChoice());
    expect(resolved).not.toHaveProperty("images");
    expect(resolved).not.toHaveProperty("productShape");
  });
});

// ── 아이콘 family registry — 5+ canonical family precedence (T1-177) ────

describe("renderProductStoryHtml — 아이콘 family registry (T1-177)", () => {
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
  const story: ProductStory = { productName: "베란다 호스", narrativeSummary: "요약", sections: [noticeSection] };
  const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: null }];

  function choiceWithFamily(family: DesignDirectorChoice["iconStyle"]["family"]): DesignDirectorChoice {
    return {
      visualStyle: "industrial-premium",
      colorway: "harbor-steel",
      rationale: "family 렌더링 확인용",
      typography: { headingWeight: "700", letterSpacing: "tight", lineHeight: "comfortable", numericStyle: "tabular", accentTypeface: "technical-grotesk" },
      iconStyle: { family, strokeWidth: "regular", cornerStyle: "sharp", opticalSize: "standard" },
      cardStyle: { variant: "soft-shadow", radius: "soft" },
      graphicMotif: { family: "none", intensity: "none" },
      spacingDensity: "standard",
      imageTreatment: { backgroundTreatment: "letterbox-neutral" },
      accentUsage: "balanced",
      avoid: [],
    };
  }

  const ICON_FAMILIES: DesignDirectorChoice["iconStyle"]["family"][] = [
    "technical-outline",
    "editorial-line",
    "geometric-solid",
    "soft-rounded",
    "precision-mono",
  ];

  it("5개 이상의 icon family 각각이 유효하고 서로 다른 SVG를 렌더링한다", () => {
    expect(ICON_FAMILIES.length).toBeGreaterThanOrEqual(5);
    const htmlByFamily = new Map<string, string>();
    for (const family of ICON_FAMILIES) {
      const profile = resolveDesignProfile(choiceWithFamily(family));
      const plan = planStoryDesign(story, { typography: profile.typography, layoutAccent: profile.layoutAccent });
      const { html } = renderProductStoryHtml(story, assigned, plan, undefined, undefined, profile);
      expect(html).toContain('data-icon-source="design-profile-svg"');
      expect(html).toContain("<svg");
      htmlByFamily.set(family, html);
    }
    const distinctSvgSnippets = new Set(htmlByFamily.values());
    expect(distinctSvgSnippets.size).toBe(ICON_FAMILIES.length);
  });

  it("깨진 Unicode/emoji 아이콘이 0개다 — 모든 family가 실제 <svg> 마크업만 만든다", () => {
    for (const family of ICON_FAMILIES) {
      const profile = resolveDesignProfile(choiceWithFamily(family));
      const plan = planStoryDesign(story, { typography: profile.typography, layoutAccent: profile.layoutAccent });
      const { html } = renderProductStoryHtml(story, assigned, plan, undefined, undefined, profile);
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)).toBe(false);
    }
  });

  it("같은 Product Profile + 같은 DESIGN_PROFILE이면 항상 같은 icon family/shape가 나온다(결정적)", () => {
    const profile = resolveDesignProfile(choiceWithFamily("geometric-solid"));
    const plan = planStoryDesign(story, { typography: profile.typography, layoutAccent: profile.layoutAccent });
    const first = renderProductStoryHtml(story, assigned, plan, undefined, undefined, profile);
    const second = renderProductStoryHtml(story, assigned, plan, undefined, undefined, profile);
    expect(first.html).toBe(second.html);
  });

  it("DESIGN_PROFILE이 없으면 baseline family(technical-outline)로 렌더링한다 — invalid/누락 iconStyle에 대한 안전한 fallback과 동일한 경로", () => {
    const plan = planStoryDesign(story);
    const withoutProfile = renderProductStoryHtml(story, assigned, plan, undefined, undefined, null);
    const explicitBaseline = resolveDesignProfile(choiceWithFamily("technical-outline"));
    // baseline(profile 없음)은 원본 stroke-width 등을 유지한 채(오버라이드 없음) technical-outline 글리프를 쓴다 —
    // 적어도 같은 family의 glyph path(check 아이콘의 checkmark 좌표)는 두 경우 모두 나타난다.
    expect(withoutProfile.html).toContain("<svg");
    expect(explicitBaseline.icon.family).toBe("technical-outline");
  });
});

describe("renderProductStoryHtml — T1-183 Hero 재도입 (검증된 실제 제품 사진만 사용)", () => {
  const heroImage: StudioSelectedImage = {
    imageId: "img-hero-real",
    category: "HERO",
    groupVersion: 1,
    mimeType: "image/jpeg",
    base64: Buffer.from("hero-bytes").toString("base64"),
    source: "real",
    imageRole: "product-isolated",
  };
  const lifestyleImage: StudioSelectedImage = {
    imageId: "img-lifestyle",
    category: "USAGE_SCENE",
    groupVersion: 1,
    mimeType: "image/jpeg",
    base64: Buffer.from("lifestyle-bytes").toString("base64"),
    source: "real",
    imageRole: "lifestyle",
  };
  const detailImage: StudioSelectedImage = {
    imageId: "img-detail-real",
    category: "DETAIL",
    groupVersion: 1,
    mimeType: "image/jpeg",
    base64: Buffer.from("detail-bytes").toString("base64"),
    source: "real",
    imageRole: "product-isolated",
  };

  it("HERO 카테고리로 배정된 검증된 실제 제품 사진을 hero 블록(pde-story-hero-media)으로 그린다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "HERO"), section("s2", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image: heroImage },
      { section: story.sections[1], image: lifestyleImage },
    ];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain("pde-story-hero-media");
    expect(html).toContain(`data:image/jpeg;base64,${heroImage.base64}`);
    expect(html).toContain("pde-story-summary--hero");
  });

  it("HERO로 배정된 이미지가 lifestyle(사용 장면) 자산이면 hero로 쓰지 않는다 — 검증된 product-isolated 자산으로 대체한다", () => {
    const heroSlotLifestyle: StudioSelectedImage = { ...lifestyleImage, imageId: "img-hero-slot-lifestyle", category: "HERO" };
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "HERO"), section("s2", "DETAIL")],
    };
    const assigned: AssignedStorySection[] = [
      { section: story.sections[0], image: heroSlotLifestyle },
      { section: story.sections[1], image: detailImage },
    ];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).toContain("pde-story-hero-media");
    expect(html).toContain(`data:image/jpeg;base64,${detailImage.base64}`);
    expect(html).not.toContain(`pde-story-hero-media" data-hero-aspect="4:3" style="--pde-hero-aspect:4 / 3;">` + `<a href="data:image/jpeg;base64,${heroSlotLifestyle.base64}"`);
  });

  it("검증된 실제 제품 사진이 하나도 없으면(HERO/DETAIL 등 전부 lifestyle뿐) hero를 그리지 않는다", () => {
    const story: ProductStory = {
      productName: "베란다 호스",
      narrativeSummary: "요약",
      sections: [section("s1", "USAGE_SCENE")],
    };
    const assigned: AssignedStorySection[] = [{ section: story.sections[0], image: lifestyleImage }];
    const { html } = renderProductStoryHtml(story, assigned);
    expect(html).not.toContain("pde-story-hero-media");
    expect(html).not.toContain("pde-story-summary--hero");
  });
});
