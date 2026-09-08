/**
 * LEVEL 2 상세페이지 디자인 시스템 (T1-197).
 *
 * 제품마다 AI/규칙이 고를 수 있는 layout template 후보를 정의한다.
 * 이번 benchmark(스텐 호스 세트)에는 이 중 하나(`commercial-editorial`)만
 * 실제로 적용하지만, 다른 제품이 들어오면 같은 규칙으로 다른 템플릿이
 * 선택될 수 있도록 후보 자체는 3개 모두 완성된 값으로 둔다.
 *
 * 디자인 결정권은 여기(제품 분석 결과 기반 규칙)에 있고, 렌더러
 * (`apps/web/app/level2-generate/detail-page-view.tsx`)는 선택된
 * template의 design token을 그대로 구현만 한다 — 렌더러가 스스로 색을
 * 고르지 않는다.
 */

export type DesignTemplateId = "commercial-editorial" | "technical-commerce" | "minimal-product";

export interface DesignTokens {
  templateId: DesignTemplateId;
  /** 페이지 배경 */
  background: string;
  /** 섹션/카드형 영역이 아니라, 배경과 구분되는 표면(footer 등)에만 쓴다 */
  surface: string;
  text: string;
  mutedText: string;
  /** 상품 실제 색상이 아니라 브랜드/카테고리 성격에서 고른 강조색 — 상품 색상으로 오해되지 않도록 채도를 낮춘다 */
  accent: string;
  accentSoft: string;
  headingScale: {
    hero: string;
    h2: string;
    h3: string;
    label: string;
  };
  bodyScale: {
    base: string;
    small: string;
  };
  maxWidth: string;
  sectionSpacing: { mobile: string; desktop: string };
  imageRadius: string;
  imageTreatment: "natural" | "flush" | "framed";
  grid: { benefitColumns: number; detailColumns: number };
  dividerStyle: string;
  fontHeading: string;
  fontBody: string;
}

const KOREAN_SANS =
  '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, sans-serif';

const TEMPLATES: Record<DesignTemplateId, DesignTokens> = {
  /**
   * industrial-premium — 스테인리스/금속/공구 계열처럼 신뢰감·내구성을
   * 강조해야 하는 제품. 카드/알약 대신 여백과 얇은 구분선으로 위계를
   * 만드는 에디토리얼 레이아웃, 1열 중심.
   */
  "commercial-editorial": {
    templateId: "commercial-editorial",
    background: "#F7F6F3",
    surface: "#FFFFFF",
    text: "#15181D",
    mutedText: "#63676F",
    accent: "#2B3648",
    accentSoft: "#E4E7EC",
    headingScale: {
      hero: "clamp(1.75rem, 4.5vw, 2.75rem)",
      h2: "clamp(1.25rem, 3vw, 1.625rem)",
      h3: "1.0625rem",
      label: "0.75rem",
    },
    bodyScale: { base: "1rem", small: "0.875rem" },
    maxWidth: "860px",
    sectionSpacing: { mobile: "48px", desktop: "88px" },
    imageRadius: "6px",
    imageTreatment: "natural",
    grid: { benefitColumns: 1, detailColumns: 1 },
    dividerStyle: "1px solid rgba(21,24,29,0.09)",
    fontHeading: KOREAN_SANS,
    fontBody: KOREAN_SANS,
  },
  /**
   * spec-forward — 사양/스펙이 구매 결정에 큰 비중을 차지하는 제품(가전·
   * 공구·전자류). 정보 밀도를 높이려고 benefit을 2열 그리드로 배치한다.
   */
  "technical-commerce": {
    templateId: "technical-commerce",
    background: "#F4F6F8",
    surface: "#FFFFFF",
    text: "#101418",
    mutedText: "#5B6673",
    accent: "#0F4C81",
    accentSoft: "#DCE8F2",
    headingScale: {
      hero: "clamp(1.625rem, 4vw, 2.5rem)",
      h2: "clamp(1.125rem, 2.6vw, 1.5rem)",
      h3: "1rem",
      label: "0.6875rem",
    },
    bodyScale: { base: "0.9375rem", small: "0.8125rem" },
    maxWidth: "920px",
    sectionSpacing: { mobile: "40px", desktop: "72px" },
    imageRadius: "4px",
    imageTreatment: "framed",
    grid: { benefitColumns: 2, detailColumns: 2 },
    dividerStyle: "1px solid rgba(16,20,24,0.10)",
    fontHeading: KOREAN_SANS,
    fontBody: KOREAN_SANS,
  },
  /**
   * quiet-minimal — 장식이 오히려 신뢰를 깎는 라이프스타일/뷰티 계열.
   * 강조색을 거의 쓰지 않고 사진과 여백만으로 위계를 만든다.
   */
  "minimal-product": {
    templateId: "minimal-product",
    background: "#FFFFFF",
    surface: "#FAFAFA",
    text: "#141414",
    mutedText: "#7A7A7A",
    accent: "#141414",
    accentSoft: "#EEEEEE",
    headingScale: {
      hero: "clamp(1.625rem, 4vw, 2.375rem)",
      h2: "clamp(1.125rem, 2.6vw, 1.375rem)",
      h3: "1rem",
      label: "0.6875rem",
    },
    bodyScale: { base: "1rem", small: "0.875rem" },
    maxWidth: "780px",
    sectionSpacing: { mobile: "56px", desktop: "104px" },
    imageRadius: "2px",
    imageTreatment: "flush",
    grid: { benefitColumns: 1, detailColumns: 1 },
    dividerStyle: "1px solid rgba(20,20,20,0.07)",
    fontHeading: KOREAN_SANS,
    fontBody: KOREAN_SANS,
  },
};

export interface DesignSelection {
  templateId: DesignTemplateId;
  tokens: DesignTokens;
  /** 왜 이 템플릿을 골랐는지 — 사람이 확인 가능한 근거 문장 */
  reason: string;
}

const INDUSTRIAL_MATERIAL_HINTS = ["스테인리스", "stainless", "금속", "metal", "황동", "brass", "steel", "철"];
const INDUSTRIAL_CATEGORY_HINTS = ["하드웨어", "공구", "산업", "생활", "주방", "호스", "청소"];

/**
 * 순수 함수 — 검증된 제품 정보(소재)와 Level1Product.category만으로
 * template을 고른다. 별도 AI 호출을 새로 만들지 않는다(비용 최소화
 * 원칙) — 이미 이 생성이 갖고 있는 값만 본다.
 */
export function selectDesignTemplate(input: {
  category: string | null;
  materials: string[];
}): DesignSelection {
  const category = (input.category ?? "").toLowerCase();
  const materials = input.materials.map((m) => m.toLowerCase());

  const hasIndustrialMaterial = materials.some((m) =>
    INDUSTRIAL_MATERIAL_HINTS.some((hint) => m.includes(hint)),
  );
  const hasIndustrialCategory = INDUSTRIAL_CATEGORY_HINTS.some((hint) => category.includes(hint));

  if (hasIndustrialMaterial || hasIndustrialCategory) {
    const evidence = [
      hasIndustrialMaterial ? `소재에 금속/스테인리스 계열이 포함됨(${input.materials.join(", ") || "확인됨"})` : null,
      hasIndustrialCategory ? `카테고리(${input.category})가 생활/하드웨어 성격` : null,
    ].filter((v): v is string => Boolean(v));
    return {
      templateId: "commercial-editorial",
      tokens: TEMPLATES["commercial-editorial"],
      reason: `산업/생활용품 성격의 제품으로 판단해 industrial-premium 톤의 commercial-editorial 템플릿을 선택함 — ${evidence.join(" · ")}`,
    };
  }

  if (materials.length === 0 && !category) {
    return {
      templateId: "minimal-product",
      tokens: TEMPLATES["minimal-product"],
      reason: "카테고리·소재 정보가 확인되지 않아, 정보 부족을 장식으로 가리지 않는 minimal-product 템플릿을 기본값으로 선택함",
    };
  }

  return {
    templateId: "technical-commerce",
    tokens: TEMPLATES["technical-commerce"],
    reason: "산업/생활용품 신호는 없으나 소재·카테고리 정보가 있어 사양 정보를 2열로 강조하는 technical-commerce 템플릿을 선택함",
  };
}

export function getDesignTokens(templateId: DesignTemplateId): DesignTokens {
  return TEMPLATES[templateId];
}
