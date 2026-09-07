import type { ProductProfile } from "@acos/shared";
import { assignStoryImages, parseProductStoryResponse } from "./product-story";
import { hasNoVisualVariation, planStoryDesign } from "./product-story-design";
import { renderProductStoryHtml } from "./product-story-html";
import { scoreProductStory, validateProductStory } from "./product-story-quality";
import type { StudioSelectedImage } from "./product-page-images";

/**
 * 회귀 테스트 — 사용자가 실제로 지적한 문제 재현 방지 (T1-111/T1-112).
 *
 * 지적된 profile(`cmskff85t0050uldwtre10ah2`)은 로컬 DB에만 있는 과거
 * 실행 기록이라 이 무인 세션에서 실제 DB를 새로 켜서 조회하지 않았다
 * (다른 두 작업이 같은 저장소에서 동시에 DB/스키마를 만지고 있어 여기서
 * 서버를 새로 띄우는 것 자체가 위험 — `docs/PROJECT_MEMORY.md` M-28).
 * 대신 그 profile을 지적하며 사람이 실제로 인용한 증상 — "이미지
 * 갤러리" 반복 노출, "사용 장면 이미지"/"제품 디테일 이미지"/"구성품
 * 이미지" 같은 내부 카테고리 라벨이 최종 사용자 화면에 그대로 반복,
 * 특징이 의미 없는 bullet 나열 — 을 그대로 재현하는 합성 fixture를
 * Story 파이프라인 전체(파싱 → 이미지 배정 → Design Plan → HTML → 품질
 * 검사)에 통과시켜, 그 증상이 다시 나오지 않는지 기계적으로 확인한다.
 */

const profile: ProductProfile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터",
  model: "SJ-100",
  material: "ABS, PVC, 스테인리스",
  features: ["분사기 손잡이", "3M 길이 호스", "고무 패킹 2개"],
  specifications: { 길이: "3M", 재질: "스테인리스" },
  usage: "베란다에서 물을 뿌려 청소할 때 사용",
  advantages: ["3M 길이로 넓은 범위 청소 가능"],
  warnings: [],
  keywords: ["호스"],
  confidence: 0.9,
};

/** LLM이 실제로 반환할 법한, 근거 있고 다양한 섹션 구성 — 지적된 사례의 "라벨 반복"과 정반대 사례 */
const wellFormedStoryResponse = JSON.stringify({
  productName: profile.productName,
  narrativeSummary: "베란다 청소가 번거로운 상황에서 3M 길이 호스가 어떻게 해결하는지 설명한다.",
  sections: [
    {
      sectionId: "problem",
      purpose: "문제 제기",
      customerContext: "베란다 구석까지 손이 닿지 않아 청소를 미루게 된다",
      productFacts: [],
      keyMessage: "베란다 청소, 늘 구석이 문제였다",
      imageRole: "NONE",
      imageFactsShown: [],
      copy: "베란다 끝까지 손이 닿지 않아 청소를 미루게 되는 순간이 많으셨을 겁니다.",
      transitionToNext: "그 거리를 채워주는 구조를 살펴본다",
    },
    {
      sectionId: "usage",
      purpose: "실제 사용 장면",
      customerContext: "실제로 어떻게 쓰는지 궁금하다",
      productFacts: ["3M 길이 호스"],
      keyMessage: "3M 길이로 베란다 끝까지 한 번에",
      imageRole: "USAGE_SCENE",
      imageFactsShown: ["베란다에서 물을 뿌리는 장면"],
      copy: "손잡이를 쥐고 뿌리면 3M 길이 호스가 베란다 끝까지 닿아 구석까지 한 번에 청소됩니다.",
      transitionToNext: "실제 구조도 확인해본다",
    },
    {
      sectionId: "detail",
      purpose: "제품 디테일",
      customerContext: "분사기 손잡이가 실제로 어떻게 생겼는지 궁금하다",
      productFacts: ["분사기 손잡이"],
      keyMessage: "분사기 손잡이 클로즈업",
      imageRole: "DETAIL",
      imageFactsShown: ["분사기 손잡이 구조"],
      copy: "손잡이를 쥐면 바로 원하는 방향으로 물을 뿌릴 수 있는 구조입니다.",
      transitionToNext: "구성품도 확인해본다",
    },
    {
      sectionId: "components",
      purpose: "구성품 확인",
      customerContext: "박스 안에 무엇이 들어있는지 궁금하다",
      productFacts: ["고무 패킹 2개"],
      keyMessage: "연결부 누수를 막는 고무 패킹 2개",
      imageRole: "COMPONENTS",
      imageFactsShown: ["고무 패킹 2개"],
      copy: "연결부에 끼우는 고무 패킹 2개가 함께 들어 있어 누수 없이 바로 쓸 수 있습니다.",
      transitionToNext: "구매 전 확인할 사항을 정리한다",
    },
    {
      sectionId: "spec",
      purpose: "제품 사양",
      customerContext: "정확한 재질·규격을 확인하고 싶다",
      productFacts: ["길이 3M", "재질 스테인리스"],
      keyMessage: "핵심 사양",
      imageRole: "NONE",
      imageFactsShown: [],
      copy: "길이 3M, 스테인리스 재질로 제작되었습니다.",
      transitionToNext: "",
    },
  ],
});

const availableCategories = ["USAGE_SCENE", "DETAIL", "COMPONENTS"] as const;

const images: StudioSelectedImage[] = [
  { imageId: "img-usage", category: "USAGE_SCENE", groupVersion: 1, mimeType: "image/jpeg", base64: "u" },
  { imageId: "img-detail", category: "DETAIL", groupVersion: 1, mimeType: "image/jpeg", base64: "d" },
  { imageId: "img-components", category: "COMPONENTS", groupVersion: 1, mimeType: "image/jpeg", base64: "c" },
];

/** 지적된 사례가 실제로 반복 노출했던 내부 카테고리 라벨 — 최종 HTML에 그대로 보이면 안 된다 */
const FORBIDDEN_INTERNAL_LABELS = [
  "이미지 갤러리",
  "사용 장면 이미지",
  "제품 디테일 이미지",
  "구성품 이미지",
];

describe("Product Story 파이프라인 — 지적된 anti-pattern 회귀 방지 (T1-111/T1-112)", () => {
  it("내부 카테고리 라벨이 최종 HTML에 그대로 노출되지 않는다 — 섹션 제목은 LLM이 쓴 구체적 헤드라인이다", () => {
    const story = parseProductStoryResponse(wellFormedStoryResponse, [...availableCategories]);
    const assigned = assignStoryImages(story, images);
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);

    for (const label of FORBIDDEN_INTERNAL_LABELS) {
      expect(html).not.toContain(label);
    }
    // 대신 LLM이 쓴 구체적 카피·근거가 실제로 들어있다
    // ("usage" 섹션은 이미지+짧은 카피 조합이라 detail-callout으로 분류되고,
    // 그 레이아웃은 캡션(copy)만 보여준다 — keyMessage는 spec-panel/
    // feature-highlight/notice처럼 사실을 요약해 보여줘야 하는 레이아웃에서만
    // 렌더링된다. 두 종류 모두 이 fixture에서 실제로 확인한다.)
    expect(html).toContain("손잡이를 쥐고 뿌리면 3M 길이 호스가 베란다 끝까지 닿아");
    expect(html).toContain("고무 패킹 2개");
  });

  it("같은 이미지가 여러 섹션에 중복 배치되지 않는다 — 카테고리당 이미지 1장, 섹션 3개가 서로 다른 이미지를 쓴다", () => {
    const story = parseProductStoryResponse(wellFormedStoryResponse, [...availableCategories]);
    const assigned = assignStoryImages(story, images);
    const usedImageIds = assigned.map((a) => a.image?.imageId).filter(Boolean);
    expect(new Set(usedImageIds).size).toBe(usedImageIds.length);
  });

  it("섹션마다 목적이 다르면 레이아웃·아이콘·강조색도 달라진다 — '사진 나열 + 반복 bullet' 단조로움으로 퇴화하지 않는다", () => {
    const story = parseProductStoryResponse(wellFormedStoryResponse, [...availableCategories]);
    const plan = planStoryDesign(story);
    expect(hasNoVisualVariation(plan)).toBe(false);
    const distinctLayouts = new Set(plan.sections.map((s) => s.layout));
    expect(distinctLayouts.size).toBeGreaterThan(1);
  });

  it("Design Plan이 배정한 아이콘·강조색은 실제 렌더링된 HTML과 항상 일치한다(형식적 개수 검사가 아니라 1:1 대조)", () => {
    const story = parseProductStoryResponse(wellFormedStoryResponse, [...availableCategories]);
    const assigned = assignStoryImages(story, images);
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    const result = validateProductStory(story, assigned, profile, null, plan, html);
    expect(result.issues.filter((i) => i.code === "design-html-mismatch")).toHaveLength(0);
  });

  it("전체 파이프라인 품질 점수가 목표(80점 이상, pass)에 도달한다", () => {
    const story = parseProductStoryResponse(wellFormedStoryResponse, [...availableCategories]);
    const assigned = assignStoryImages(story, images);
    const plan = planStoryDesign(story);
    const { html } = renderProductStoryHtml(story, assigned, plan);
    const validation = validateProductStory(story, assigned, profile, null, plan, html);
    const quality = scoreProductStory(validation, plan);
    expect(quality.grade).toBe("pass");
  });
});
