import type { ProductProfile } from "@acos/shared";
import {
  classifyProductCharacter,
  rankPurchasePoints,
  selectProductPageTemplate,
} from "./product-page-template-selection";

const baseProfile: ProductProfile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터",
  model: "SJ-100",
  material: "ABS, PVC, 스테인리스",
  features: ["분사기 손잡이", "나팔형 분사구"],
  specifications: { 길이: "3M", 원산지: "한국" },
  usage: "베란다·정원에서 물을 뿌려 청소할 때 사용",
  advantages: ["3M 길이로 넓은 범위 청소 가능", "사용이 편리합니다"],
  warnings: [],
  keywords: ["호스", "청소"],
  confidence: 0.9,
};

describe("classifyProductCharacter", () => {
  it("청소/제거 키워드가 있으면 functional-proof로 분류하고 effectClaim을 true로 표시한다", () => {
    const result = classifyProductCharacter(baseProfile);
    expect(result.character).toBe("functional-proof");
    expect(result.hasEffectClaim).toBe(true);
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("인테리어/감성 키워드만 있으면 lifestyle-mood로 분류한다", () => {
    const lifestyleProfile: ProductProfile = {
      ...baseProfile,
      productName: "감성 인테리어 러그",
      features: ["북유럽 스타일 데코"],
      usage: "거실 인테리어 소품으로 사용",
      advantages: ["감성적인 무드 연출"],
      keywords: ["인테리어"],
    };
    const result = classifyProductCharacter(lifestyleProfile);
    expect(result.character).toBe("lifestyle-mood");
  });

  it("기능/감성 키워드가 전혀 없으면 value-utility로 분류하고 근거를 비워 둔다", () => {
    const neutralProfile: ProductProfile = {
      ...baseProfile,
      productName: "보관용 플라스틱 상자",
      features: ["대용량"],
      usage: null,
      advantages: [],
      keywords: [],
      specifications: {},
    };
    const result = classifyProductCharacter(neutralProfile);
    expect(result.character).toBe("value-utility");
    expect(result.matchedKeywords).toEqual([]);
  });

  it("기능성과 감성 키워드가 동시에 있으면 기능성을 우선한다 (제품 동일성/증거 우선)", () => {
    const mixedProfile: ProductProfile = {
      ...baseProfile,
      productName: "인테리어 감성 청소솔",
      keywords: ["인테리어", "청소"],
    };
    const result = classifyProductCharacter(mixedProfile);
    expect(result.character).toBe("functional-proof");
  });
});

describe("selectProductPageTemplate", () => {
  it("효과를 주장하는 기능성 제품(베란다 호스)은 living-d-proof를 고른다", () => {
    const result = selectProductPageTemplate(baseProfile);
    expect(result.templateKey).toBe("living-d-proof");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("효과 주장 없는 기능성 제품은 living-a-trust를 고른다", () => {
    const profile: ProductProfile = {
      ...baseProfile,
      productName: "조립식 선반 브라켓",
      features: ["고정 브라켓"],
      usage: "선반을 벽에 고정할 때 사용",
      advantages: ["튼튼한 고정력"],
      keywords: ["조립"],
    };
    const result = selectProductPageTemplate(profile);
    expect(result.templateKey).toBe("living-a-trust");
  });

  it("감성/라이프스타일형 제품은 living-b-mood를 고른다", () => {
    const profile: ProductProfile = {
      ...baseProfile,
      productName: "감성 인테리어 러그",
      features: ["북유럽 스타일 데코"],
      usage: "거실 인테리어 소품",
      advantages: ["감성적인 무드 연출"],
      keywords: ["인테리어"],
    };
    const result = selectProductPageTemplate(profile);
    expect(result.templateKey).toBe("living-b-mood");
  });

  it("스펙이 6개를 넘는 정보 밀도 높은 제품은 living-e-minimal을 고른다", () => {
    const profile: ProductProfile = {
      ...baseProfile,
      productName: "다목적 보관 용기",
      features: [],
      usage: null,
      advantages: [],
      keywords: [],
      specifications: {
        가로: "10cm", 세로: "20cm", 높이: "5cm", 무게: "300g",
        재질: "PP", 용량: "1L", 색상: "블루",
      },
    };
    const result = selectProductPageTemplate(profile);
    expect(result.templateKey).toBe("living-e-minimal");
  });

  it("판정 근거가 전혀 없으면 basic(기본형)을 고른다", () => {
    const profile: ProductProfile = {
      ...baseProfile,
      productName: "보관용 플라스틱 상자",
      features: [],
      usage: null,
      advantages: [],
      keywords: [],
      specifications: {},
    };
    const result = selectProductPageTemplate(profile);
    expect(result.templateKey).toBe("basic");
  });

  it("등록된 템플릿 키 중 하나만 반환한다 (product-page-html.ts와 일치)", () => {
    const validKeys = new Set([
      "basic",
      "living-a-trust",
      "living-b-mood",
      "living-c-value",
      "living-d-proof",
      "living-e-minimal",
    ]);
    const profiles = [baseProfile, { ...baseProfile, productName: "감성 인테리어", keywords: ["인테리어"] }];
    for (const profile of profiles) {
      expect(validKeys.has(selectProductPageTemplate(profile).templateKey)).toBe(true);
    }
  });
});

describe("rankPurchasePoints", () => {
  it("수치/단위가 포함된 구체적인 문구를 막연한 문구보다 앞에 둔다", () => {
    const result = rankPurchasePoints(baseProfile);
    expect(result[0]).toBe("3M 길이로 넓은 범위 청소 가능");
    expect(result).toContain("사용이 편리합니다");
  });

  it("중복을 제거한다", () => {
    const profile: ProductProfile = {
      ...baseProfile,
      advantages: ["3M 길이", "3M 길이", "편리함"],
    };
    const result = rankPurchasePoints(profile);
    expect(result.filter((p) => p === "3M 길이").length).toBe(1);
  });

  it("maxCount로 개수를 제한한다", () => {
    const profile: ProductProfile = {
      ...baseProfile,
      advantages: ["포인트1", "포인트2", "포인트3", "포인트4", "포인트5"],
    };
    const result = rankPurchasePoints(profile, 2);
    expect(result.length).toBe(2);
  });

  it("advantages가 비어 있으면 빈 배열을 반환한다", () => {
    const profile: ProductProfile = { ...baseProfile, advantages: [] };
    expect(rankPurchasePoints(profile)).toEqual([]);
  });
});
