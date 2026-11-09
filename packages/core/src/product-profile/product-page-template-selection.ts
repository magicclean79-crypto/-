import type { ProductProfile } from "@acos/shared";

/**
 * Product Profile → 상세페이지 템플릿/구매 포인트 자동 선택. (T1-77)
 *
 * 근거: `reports/LIVING_GOODS_DESIGN_PRINCIPLES.md`(b) IF-THEN 표 — 실제
 * IKEA Korea·다이소몰·지그재그 53건 캡처를 관찰해 만든 규칙이다. 이
 * 파이프라인에는 "리뷰 수"·"가격"처럼 그 규칙표가 전제하는 e커머스
 * 런타임 데이터가 없다(Product Profile은 판매 화면이 아니라 상세페이지
 * 재료다) — 그래서 여기서는 **Product Profile 텍스트만으로 판정 가능한
 * 규칙만** 골라 옮겼다: 기능성/증거형(규칙4·11) vs 감성/무드형(규칙5),
 * 스펙 복잡도(규칙6), 도매/위탁배송 채널(규칙13, `reports/
 * MAGICCLEAN_BRAND_BASELINE.md` §7 — 매직크린 자신이 이 채널이다: 리뷰·
 * 디자이너 크레딧 없이 정량 정보로 신뢰를 쌓는다).
 *
 * `PRODUCT_PAGE_TEMPLATES`(product-page-html.ts)에 이미 등록된 6개
 * 템플릿 중에서만 고른다 — 이 함수가 새 템플릿을 만들지는 않는다. 새
 * 카테고리 전용 템플릿(주방용품형·산업용품형 등)은 시장 조사가 그
 * 카테고리까지 끝난 뒤(§ "다음 단계") 추가할 대상이다.
 *
 * 순수 함수 — LLM 호출 없음. Product Profile에 없는 사실을 만들어내지
 * 않는다(추측 금지, MASTER_GUIDE §2 철학2) — 텍스트에 이미 있는 단어를
 * 키워드로 찾아 분류할 뿐이다.
 */

export type ProductPageCharacter = "functional-proof" | "lifestyle-mood" | "value-utility";

/** 기능 증명형 — 사용 장면/증거 사진이 필요한 제품 (규칙4) */
const FUNCTIONAL_KEYWORDS = [
  "청소", "세척", "제거", "살균", "탈취", "방수", "방청", "광택", "연마",
  "절단", "고정", "조립", "부착", "걸이", "브러시", "솔", "걸레", "스펀지",
  "호스", "분사", "스프레이", "압축", "필터", "방충", "방역", "잠금",
  "체결", "배수", "누수",
];

/** 청소/제거 효과를 명시적으로 주장하는 제품 — 사용 흔적/전후 사진 근거 필요 (규칙11) */
const EFFECT_CLAIM_KEYWORDS = ["청소", "세척", "제거", "살균", "탈취", "방수", "방청", "누수"];

/** 인테리어/감성/라이프스타일형 — 소품 연출 무드컷이 필요한 제품 (규칙5) */
const LIFESTYLE_KEYWORDS = [
  "인테리어", "데코", "무드", "감성", "슬리퍼", "러그", "쿠션", "홈데코",
  "디자인", "스타일링", "플레이팅", "장식",
];

function textCorpus(profile: ProductProfile): string {
  return [
    profile.productName,
    profile.material ?? "",
    ...profile.features,
    profile.usage ?? "",
    ...profile.advantages,
    ...profile.keywords,
    ...Object.values(profile.specifications),
  ]
    .join(" ")
    .toLowerCase();
}

function countMatches(corpus: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => corpus.includes(keyword.toLowerCase()));
}

export interface ProductCharacterClassification {
  character: ProductPageCharacter;
  /** 판정에 실제로 걸린 단어 — "왜 이렇게 골랐는지" 흔적을 남긴다(MASTER_GUIDE 철학5) */
  matchedKeywords: string[];
  /** 청소/제거 효과를 주장해 사용 흔적 사진이 필요한지 (규칙11) */
  hasEffectClaim: boolean;
  /** 스펙 항목 수 — 규칙6(단순 스펙) 판정에 쓴다 */
  specCount: number;
}

/**
 * Product Profile 텍스트에서 기능성/감성형 여부를 판정한다. 두 키워드
 * 집합에 모두 걸리면(예: "청소" + "인테리어") 기능성을 우선한다 —
 * 제품 동일성/사실 증명이 감성 연출보다 항상 우선한다는 원칙
 * (MASTER_GUIDE §2 철학1)과 같은 순서다.
 */
export function classifyProductCharacter(profile: ProductProfile): ProductCharacterClassification {
  const corpus = textCorpus(profile);
  const functionalMatches = countMatches(corpus, FUNCTIONAL_KEYWORDS);
  const lifestyleMatches = countMatches(corpus, LIFESTYLE_KEYWORDS);
  const effectMatches = countMatches(corpus, EFFECT_CLAIM_KEYWORDS);
  const specCount = Object.keys(profile.specifications).length;

  let character: ProductPageCharacter;
  let matchedKeywords: string[];
  if (functionalMatches.length > 0) {
    character = "functional-proof";
    matchedKeywords = functionalMatches;
  } else if (lifestyleMatches.length > 0) {
    character = "lifestyle-mood";
    matchedKeywords = lifestyleMatches;
  } else {
    character = "value-utility";
    matchedKeywords = [];
  }

  return {
    character,
    matchedKeywords,
    hasEffectClaim: effectMatches.length > 0,
    specCount,
  };
}

export interface ProductPageTemplateSelection {
  templateKey: string;
  character: ProductPageCharacter;
  /** 사람이 읽을 수 있는 선택 근거 — 브라우저 화면에 그대로 보여줄 수 있다 */
  reasons: string[];
}

/**
 * Product Profile을 보고 등록된 6개 템플릿 중 하나를 고른다.
 *
 * 분기 순서(전부 `reports/LIVING_GOODS_DESIGN_PRINCIPLES.md`(b) 근거):
 * 1) 청소/제거 등 효과를 주장하는 기능성 제품 → `living-d-proof`
 *    (규칙4·11 — 사진1→설명→사진2→사용방법으로 사진 증거를 쌓는 구성이
 *    이미 이 템플릿의 구조다, product-page-html.ts renderMixedStory)
 * 2) 효과 주장은 없지만 기능성인 제품 → `living-a-trust`
 *    (규칙13 — 도매/위탁배송 채널은 리뷰·디자이너 크레딧 대신 스펙
 *    체크리스트 같은 정량 신호로 신뢰를 쌓는다. 매직크린 자신이 이
 *    채널이다, MAGICCLEAN_BRAND_BASELINE.md §7)
 * 3) 감성/라이프스타일형 제품 → `living-b-mood`
 *    (규칙5 — 오버레이 없는 무드 Hero + 감성 문구가 구매포인트보다 먼저)
 * 4) 스펙이 6개를 넘는 정보 밀도가 높은 제품(생활용품이 아닌 산업/공구성
 *    제품일 가능성) → `living-e-minimal`
 *    (원리5 — IKEA는 표 대신 접이식 아코디언으로 정보 밀도를 관리한다)
 * 5) 그 외(분류 근거가 부족한 경우) → `basic`(Template V1, 안전 기본값)
 *
 * `basic`을 마지막 기본값으로 둔 이유: 키워드가 하나도 안 걸리면(=근거가
 * 없으면) 색상·구성이 강한 생활용품 템플릿보다 가장 무난한 템플릿을
 * 쓴다 — 근거 없이 화려한 스타일을 고르지 않는다(추측 금지 원칙).
 */
export function selectProductPageTemplate(profile: ProductProfile): ProductPageTemplateSelection {
  const classification = classifyProductCharacter(profile);
  const { character, matchedKeywords, hasEffectClaim, specCount } = classification;

  if (character === "functional-proof" && hasEffectClaim) {
    return {
      templateKey: "living-d-proof",
      character,
      reasons: [
        `기능성 키워드 감지: ${matchedKeywords.join(", ")}`,
        "청소/제거 등 효과를 주장하는 제품 — 사진 증거를 쌓는 기능증명형 템플릿 선택 (규칙4·11)",
      ],
    };
  }
  if (character === "functional-proof") {
    return {
      templateKey: "living-a-trust",
      character,
      reasons: [
        `기능성 키워드 감지: ${matchedKeywords.join(", ")}`,
        "도매/위탁배송 채널은 스펙 근거 중심 신뢰형 템플릿을 우선한다 (규칙13)",
      ],
    };
  }
  if (character === "lifestyle-mood") {
    return {
      templateKey: "living-b-mood",
      character,
      reasons: [
        `감성/라이프스타일 키워드 감지: ${matchedKeywords.join(", ")}`,
        "인테리어/감성형 제품 — 무드 Hero 템플릿 선택 (규칙5)",
      ],
    };
  }
  if (specCount > 6) {
    return {
      templateKey: "living-e-minimal",
      character,
      reasons: [
        `스펙 항목 ${specCount}개 — 정보 밀도가 높은 제품`,
        "표 대신 접이식 아코디언으로 정보를 정리하는 미니멀 템플릿 선택 (원리5)",
      ],
    };
  }
  return {
    templateKey: "basic",
    character,
    reasons: ["기능성/감성 키워드가 뚜렷하지 않음 — 근거 없이 스타일을 고르지 않고 기본형 유지"],
  };
}

/**
 * 구매 포인트(advantages)를 화면에 보여줄 개수로 우선순위를 매겨 자른다.
 *
 * 근거: `reports/LIVING_GOODS_DESIGN_PRINCIPLES.md` 원리1/규칙1·13 —
 * 이 파이프라인에는 리뷰 수 같은 실제 신뢰 신호가 없으므로, 대신 **수치·
 * 단위가 포함된 구체적 문구**(예: "3M 길이", "체결력 2배")를 막연한
 * 문구("사용이 편리합니다")보다 앞에 둔다 — 검증 가능한 사실을 우선한다는
 * 원칙(추측 금지)과 같은 방향이다. 새 문구를 만들지 않는다 — 이미 있는
 * `advantages`의 순서만 바꾸고 개수만 제한한다.
 */
export function rankPurchasePoints(profile: ProductProfile, maxCount = 4): string[] {
  const unique = [...new Set(profile.advantages)];
  const hasDigit = /\d/;
  const concrete = unique.filter((point) => hasDigit.test(point));
  const vague = unique.filter((point) => !hasDigit.test(point));
  return [...concrete, ...vague].slice(0, maxCount);
}
