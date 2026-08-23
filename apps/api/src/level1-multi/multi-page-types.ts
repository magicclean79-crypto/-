/**
 * LEVEL 2 다중 상세페이지 생성 (T1-191) — 분석 호출·페이지 생성 호출이
 * 공유하는 자료구조. `@acos/shared`에는 추가하지 않는다(T1-189와 같은
 * 이유 — 동시 진행 작업과 충돌을 피한다, 이번 작업은 이 모듈 안에서
 * 완결된다).
 */

/** 사람이 확인한 사실만 담는다 — 확인되지 않은 값은 null(단수) / []( 배열). */
export interface VerifiedProductFacts {
  name: string | null;
  brand: string | null;
  model: string | null;
  manufacturer: string | null;
  originCountry: string | null;
  materials: string[];
  dimensions: string | null;
  includedComponents: string[];
  specs: Record<string, string>;
  cautions: string[];
}

export const EMPTY_VERIFIED_PRODUCT_FACTS: VerifiedProductFacts = {
  name: null,
  brand: null,
  model: null,
  manufacturer: null,
  originCountry: null,
  materials: [],
  dimensions: null,
  includedComponents: [],
  specs: {},
  cautions: [],
};

/** 업로드 asset 하나를 분석 호출이 스스로 분류한 결과. */
export type ClassifiedAssetRole =
  | "ACTUAL_PRODUCT"
  | "PACKAGING"
  | "LABEL"
  | "SPEC"
  | "BARCODE"
  | "MANUAL"
  | "LIFESTYLE"
  | "UNKNOWN";

export interface AssetRoleClassification {
  assetIndex: number;
  role: ClassifiedAssetRole;
}

export interface PagePlanItem {
  pageIndex: number;
  pageRole: string;
  title: string;
  designBrief: string;
}

/** 분석 호출(Call A) 응답 계약 — JSON 텍스트 하나로 전부 받는다. */
export interface AnalysisResult {
  verifiedProductFacts: VerifiedProductFacts;
  assetRoles: AssetRoleClassification[];
  pagePlan: PagePlanItem[];
}

export const MIN_PAGES = 4;
export const MAX_PAGES = 6;

/**
 * 최소 의미 구조 (T1-195 요청 사양) — 상세페이지가 갖춰야 할 필수
 * 카테고리. 제품마다 문구·구도는 AI가 자유롭게 정하되(`title`·
 * `designBrief`), `pageRole`은 반드시 이 네 가지 중 하나여야 한다.
 * PRODUCT INFO(요청 사양 5번)는 AI 이미지가 아니라 별도 구조화된
 * HTML 영역(`apps/web/app/level2-generate/[generationId]`)이라 이
 * 목록에 없다 — 항상 존재하므로 검증 대상이 아니다.
 */
export const MANDATORY_PAGE_ROLES = ["HERO", "FEATURES", "USE", "COMPONENTS"] as const;
export type MandatoryPageRole = (typeof MANDATORY_PAGE_ROLES)[number];

/** 필수 4종 외에 AI가 선택적으로 추가할 수 있는 갤러리/디테일 역할. */
export const OPTIONAL_PAGE_ROLE = "GALLERY";

export const ALL_PAGE_ROLES = [...MANDATORY_PAGE_ROLES, OPTIONAL_PAGE_ROLE] as const;

/** 대소문자·공백 차이를 흡수해 pageRole을 표준 카테고리로 정규화한다. */
export function normalizePageRole(role: string): string {
  return role.trim().toUpperCase();
}

/** pagePlan이 필수 4종 역할을 각각 최소 1번씩 포함하는지 확인한다. */
export function findMissingMandatoryRoles(pagePlan: { pageRole: string }[]): MandatoryPageRole[] {
  const present = new Set(pagePlan.map((p) => normalizePageRole(p.pageRole)));
  return MANDATORY_PAGE_ROLES.filter((role) => !present.has(role));
}

/**
 * 누락된 필수 역할을 위한 대체 페이지 계획을 만든다 — 확인되지 않은
 * 제품 세부사항을 지어내지 않는, 역할 그 자체에서 나오는 일반적인
 * 장면 설명만 쓴다(AI가 이미 낸 계획을 우선하고, 이건 최후의 보수적
 * fallback이다).
 */
const MANDATORY_ROLE_FALLBACK: Record<MandatoryPageRole, { title: string; designBrief: string }> = {
  HERO: {
    title: "대표 이미지",
    designBrief: "제품 전체가 또렷이 보이는 대표 이미지 — 실제 제품의 형태·색상·구성을 그대로 유지한 채 보기 좋은 배경과 조명으로 표현하세요.",
  },
  FEATURES: {
    title: "핵심 특징",
    designBrief: "제품의 핵심 특징이 잘 드러나는 클로즈업/디테일 샷 — 실제 제품의 구조와 디테일을 있는 그대로 강조하세요.",
  },
  USE: {
    title: "사용 장면",
    designBrief: "이 제품을 실제로 사용하는 자연스러운 장면 — 제품의 형태·구성을 바꾸지 않고 실제 사용 맥락만 보여주세요.",
  },
  COMPONENTS: {
    title: "구성품",
    designBrief: "제품의 구성품을 가지런히 펼쳐 놓고 한눈에 보여주는 장면 — 구성품을 추가하거나 빼지 말고 실제 그대로 배치하세요.",
  },
};

/**
 * `findMissingMandatoryRoles`가 찾은 누락 역할을 채우고, 표시 순서를
 * HERO → FEATURES → USE → COMPONENTS → (그 외/GALLERY) 순으로 정렬해
 * pageIndex를 다시 매긴다. AI가 이미 만든 페이지는 절대 삭제하지
 * 않는다 — 부족한 자리만 보수적으로 채운다.
 */
export function ensureMandatoryPagePlan(pagePlan: PagePlanItem[]): {
  pagePlan: PagePlanItem[];
  injectedRoles: MandatoryPageRole[];
} {
  const missing = findMissingMandatoryRoles(pagePlan);
  const withFallback = [...pagePlan];
  for (const role of missing) {
    const fallback = MANDATORY_ROLE_FALLBACK[role];
    withFallback.push({ pageIndex: 0, pageRole: role, title: fallback.title, designBrief: fallback.designBrief });
  }

  const priority = (role: string): number => {
    const idx = ALL_PAGE_ROLES.indexOf(normalizePageRole(role) as (typeof ALL_PAGE_ROLES)[number]);
    return idx === -1 ? ALL_PAGE_ROLES.length : idx;
  };
  const sorted = withFallback
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const byRole = priority(a.item.pageRole) - priority(b.item.pageRole);
      return byRole !== 0 ? byRole : a.originalIndex - b.originalIndex;
    })
    .map(({ item }, i) => ({ ...item, pageIndex: i + 1 }));

  return { pagePlan: sorted, injectedRoles: missing };
}
