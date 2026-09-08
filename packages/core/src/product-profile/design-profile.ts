import type { StoryLayoutVariant } from "./product-story-design";
import type { StoryTypography } from "./product-story-design";
import type { StoryVisualDesignTokens } from "./product-composition-art-direction";

/**
 * DESIGN_PROFILE — Design Director가 만드는 제품별 시각 시스템 결정. (T1-176)
 *
 * ## 왜 이 파일이 필요한가
 *
 * `product-story-design.ts`의 `LAYOUT_VISUAL_TOKENS`와
 * `product-composition-art-direction.ts`의 `buildStoryVisualTokens()`는
 * 둘 다 **입력이 없는 순수 함수**다 — 어떤 제품이든 항상 같은 teal/blue/
 * indigo 팔레트·같은 Pretendard 타이포·같은 라인 아이콘·같은 카드 톤이
 * 나온다. 검정 금속 호스 세트든 파스텔 아기용품이든 렌더러가 만드는 시각
 * 시스템은 완전히 동일하다 — "제품 특성에 맞는 디자인 시스템"이라는 목표와
 * 어긋난다.
 *
 * 이 파일은 그 간극을 메우는 **계약**을 정의한다. AI(Design Director,
 * `design-director.ts`)는 아래 enum 어휘 중에서만 선택할 수 있고, 이
 * 파일의 `resolveDesignProfile()`이 그 선택을 실제 렌더러가 쓰는 hex/px/
 * font-stack 값으로 **결정적으로** 변환한다 — AI가 임의의 CSS·hex·SVG를
 * 직접 출력하는 경로는 어디에도 없다(요청 사양: "renderer가 AI가 생성한
 * HTML/CSS를 직접 실행하거나 raw HTML을 신뢰하는 구조로 만들지 않는다").
 *
 * ## 결정성 — 이 프로젝트가 실제로 지원하는 방법만 쓴다
 *
 * `LlmCompleteRequest`(`packages/shared/src/index.ts`)에는 `temperature`·
 * `seed` 필드가 없다 — 이 프로젝트의 LLM Gateway(`apps/api/src/llm/
 * llm.service.ts`)는 이 파라미터를 어느 Provider 어댑터에도 노출하지
 * 않는다(실측 확인, 추측 아님). 그래서 "같은 제품 → 같은 DESIGN_PROFILE"은
 * 모델 파라미터가 아니라 **영속화(캐시)**로 만족시킨다 —
 * `ProductProfile.designProfile`(Prisma, 새 컬럼)에 한 번 생성된 결과를
 * 저장하고, 이후 같은 실행에 대한 재렌더링은 이 저장된 값을 재사용한다
 * (LLM 재호출 없음). `storyResult` 캐시(T1-131)와 정확히 같은 원칙이며,
 * "API 비용 최소화"(`docs/PROJECT_MEMORY.md`) 제약과도 맞는다.
 *
 * ## 제품 이미지와의 분리
 *
 * 이 파일이 정의하는 값은 전부 **HTML/CSS 렌더러가 소비하는 디자인
 * 토큰**이다 — 이미지 생성 프롬프트(`product-composition-art-direction.ts`의
 * `SectionCompositionContract`)를 만들지 않고, 참조하지도 않는다.
 * `resolveDesignProfile()`은 실제 제품 사진 asset을 전혀 입력받지 않으므로
 * 구조적으로 제품 이미지를 재구성/변경할 수 없다.
 */

// ── 1. Design Director가 선택할 수 있는 어휘 (허용된 enum) ─────────────

/**
 * 5개 이상의 premium/commerce-safe 시각 스타일 계열. 이름과 세부 톤은
 * 이 프로젝트의 기존 디자인 언어(teal/blue/indigo 계열 확장, T1-147~163)
 * 에서 파생했다 — 완전히 새로운 색 언어를 발명하지 않는다.
 */
export const VISUAL_STYLE_FAMILIES = [
  "industrial-premium",
  "editorial-minimal",
  "modern-utility",
  "soft-premium",
  "technical-performance",
] as const;
export type VisualStyleFamily = (typeof VISUAL_STYLE_FAMILIES)[number];

export const VISUAL_STYLE_FAMILY_DESCRIPTIONS: Record<VisualStyleFamily, string> = {
  "industrial-premium":
    "금속/기계적 소재, 실용적 도구성 제품 — 짙은 블루/틸/인디고, 각진 카드, 기술적 라인 아이콘",
  "editorial-minimal":
    "단색·미니멀 톤을 선호하는 라이프스타일/생활용품 — 웜 페이퍼~그레이스케일 배경, 절제된 단일 강조색",
  "modern-utility":
    "실용/청소/주방 도구 — 그린·앰버 계열, 단단한 카드 테두리, 명확한 기능 신호",
  "soft-premium":
    "패브릭·유아용품·뷰티처럼 부드러운 질감의 제품 — 로즈/세이지 계열 파스텔, 둥근 카드, 부드러운 그림자",
  "technical-performance":
    "스포츠/아웃도어/전자기기처럼 성능을 앞세우는 제품 — 카본/네이비 계열, 낮은 채도 배경, 강한 accent 대비",
};

export const COLORWAY_IDS = [
  "harbor-steel",
  "graphite-cobalt",
  "ink-paper",
  "charcoal-mono",
  "forest-lime",
  "slate-amber",
  "blush-mauve",
  "sage-cream",
  "carbon-crimson",
  "navy-electric",
] as const;
export type ColorwayId = (typeof COLORWAY_IDS)[number];

/** family → 그 family에서 고를 수 있는 colorway (family당 2개 이상 — "같은 family라도 조합에 variation 허용") */
export const FAMILY_COLORWAYS: Record<VisualStyleFamily, ColorwayId[]> = {
  "industrial-premium": ["harbor-steel", "graphite-cobalt"],
  "editorial-minimal": ["ink-paper", "charcoal-mono"],
  "modern-utility": ["forest-lime", "slate-amber"],
  "soft-premium": ["blush-mauve", "sage-cream"],
  "technical-performance": ["carbon-crimson", "navy-electric"],
};

export const HEADING_WEIGHTS = ["600", "700", "800"] as const;
export type HeadingWeight = (typeof HEADING_WEIGHTS)[number];

export const LETTER_SPACINGS = ["tight", "normal", "wide"] as const;
export type LetterSpacingId = (typeof LETTER_SPACINGS)[number];

export const LINE_HEIGHTS = ["compact", "comfortable", "relaxed"] as const;
export type LineHeightId = (typeof LINE_HEIGHTS)[number];

export const NUMERIC_STYLES = ["tabular", "standard"] as const;
export type NumericStyleId = (typeof NUMERIC_STYLES)[number];

/**
 * 라틴 전용(숫자·kicker) 폰트 조합 프리셋 — 전부 이 저장소가 이미 CSS에
 * 선언해 쓰고 있던 시스템 폰트(Bahnschrift·Georgia·Times New Roman·
 * Segoe UI Semibold, `product-story-design.ts` 기존 스택)만 재조합한다.
 * 새 웹폰트 네트워크 의존성을 추가하지 않는다.
 */
export const ACCENT_TYPEFACES = ["technical-grotesk", "editorial-serif", "rounded-sans"] as const;
export type AccentTypefaceId = (typeof ACCENT_TYPEFACES)[number];

/**
 * 아이콘 shape 계열(family) — canonical SVG icon family registry
 * (`icon-family-registry.ts`)가 실제로 렌더링할 수 있는 5개뿐이다. AI는
 * 이 중 하나만 고를 수 있고, 그 외의 임의 SVG/path를 생성하는 경로는
 * 어디에도 없다(T1-177 요청 사양 "iconStyle.family는 허용된 canonical
 * SVG icon family registry에서만 선택한다"). `strokeWidth`/`cornerStyle`/
 * `opticalSize`는 family와 별개 축이다 — family는 아이콘의 **shape
 * 언어**(윤곽선/원 뱃지/솔리드 실루엣/모눈 등)를 정하고, 나머지 셋은
 * 그 위에 균일하게 적용되는 두께/각/크기다.
 */
export const ICON_FAMILIES = [
  "technical-outline",
  "editorial-line",
  "geometric-solid",
  "soft-rounded",
  "precision-mono",
] as const;
export type IconFamilyId = (typeof ICON_FAMILIES)[number];

export const ICON_FAMILY_DESCRIPTIONS: Record<IconFamilyId, string> = {
  "technical-outline": "기존 상세페이지 기본 라인 아이콘 — 실용적 도구성 제품에 무난하게 어울리는 표준 윤곽선",
  "editorial-line": "원형 뱃지 안에 얇은 라인으로 그려진 에디토리얼 스탬프 느낌 — 미니멀/라이프스타일 톤",
  "geometric-solid": "솔리드 실루엣(채워진 도형)으로 그려진 아이콘 — 대비가 강하고 임팩트 있는 톤",
  "soft-rounded": "둥근 사각/곡선 위주의 부드러운 라인 아이콘 — 패브릭·유아용품처럼 부드러운 질감의 제품",
  "precision-mono": "모눈/제도 도면 느낌의 각진 모노 아이콘 — 기술/스포츠/전자기기처럼 정밀함을 앞세우는 제품",
};

export const ICON_STROKE_WIDTHS = ["thin", "regular", "bold"] as const;
export type IconStrokeWidthId = (typeof ICON_STROKE_WIDTHS)[number];

export const ICON_CORNER_STYLES = ["sharp", "rounded"] as const;
export type IconCornerStyleId = (typeof ICON_CORNER_STYLES)[number];

export const ICON_OPTICAL_SIZES = ["compact", "standard", "large"] as const;
export type IconOpticalSizeId = (typeof ICON_OPTICAL_SIZES)[number];

export const CARD_VARIANTS = ["flat", "outlined", "elevated", "soft-shadow"] as const;
export type CardVariantId = (typeof CARD_VARIANTS)[number];

export const CARD_RADII = ["sharp", "soft", "round"] as const;
export type CardRadiusId = (typeof CARD_RADII)[number];

export const GRAPHIC_MOTIF_FAMILIES = ["none", "dot-grid", "corner-line", "diagonal-cut", "technical-grid"] as const;
export type GraphicMotifFamilyId = (typeof GRAPHIC_MOTIF_FAMILIES)[number];

export const GRAPHIC_MOTIF_INTENSITIES = ["none", "subtle", "medium"] as const;
export type GraphicMotifIntensityId = (typeof GRAPHIC_MOTIF_INTENSITIES)[number];

export const SPACING_DENSITIES = ["compact", "standard", "spacious"] as const;
export type SpacingDensityId = (typeof SPACING_DENSITIES)[number];

export const IMAGE_BACKGROUND_TREATMENTS = ["letterbox-neutral", "letterbox-tinted", "none"] as const;
export type ImageBackgroundTreatmentId = (typeof IMAGE_BACKGROUND_TREATMENTS)[number];

export const ACCENT_USAGES = ["minimal", "balanced", "bold"] as const;
export type AccentUsageId = (typeof ACCENT_USAGES)[number];

// ── 1b. Composition system (T1-183) — 레퍼런스 수준 editorial-commerce
//      레이아웃을 위한 "구조" 토큰. 위의 어휘가 색·타이포·아이콘 같은
//      "표면" 토큰이라면, 이 절은 hero/feature row/split/included grid/
//      section rhythm/image aspect ratio처럼 페이지 구조 자체를 결정한다.
//      전부 enum이거나 이 파일이 검증한 숫자 테이블에서만 파생된다 — AI나
//      호출자가 임의 px/CSS를 주입할 방법이 없다. compositionFamily는
//      LLM Design Director가 아니라 `design-director.ts`의
//      `selectCompositionFamily()`(제품 특성 기반 결정적 규칙)가 고른다 —
//      "하드코딩 금지, 제품 특성 기반 결정 로직 필요"라는 요청 사양이면서도
//      LLM 호출을 늘리지 않는다(비용 최소화 원칙).
// ──────────────────────────────────────────────────────────────────────

/**
 * 최소 6개(T1-185 요청 사양 — "레퍼런스 수준 6+ premium composition/style
 * family"): editorial-brochure(밝은 매거진형 브로셔, 기본값) ·
 * technical-catalog(사양 중심 카탈로그) · minimal-lifestyle(여백 중심
 * 라이프스타일) · gallery-forward(실사진 밀도가 높은 제품용, 갤러리 중심) ·
 * bold-statement(장점/마케팅 포인트가 스펙보다 강한 제품용, 중앙정렬
 * 대형 헤드라인) · compact-utility(스펙은 중간 수준이되 여백을 줄인 실용
 * 카탈로그). family마다 hero/gallery/includedGrid/headline/spacing/
 * textMeasure 조합이 전부 달라 실제 레이아웃 geometry가 바뀐다
 * (`COMPOSITION_FAMILY_TOKENS` 참고).
 */
export const COMPOSITION_FAMILIES = [
  "editorial-brochure",
  "technical-catalog",
  "minimal-lifestyle",
  "gallery-forward",
  "bold-statement",
  "compact-utility",
] as const;
export type CompositionFamilyId = (typeof COMPOSITION_FAMILIES)[number];

/** Hero 제품 사진 프레임 종횡비 — 레퍼런스 사양 "hero 16:9/4:3" */
export const HERO_ASPECTS = ["16:9", "4:3"] as const;
export type HeroAspectId = (typeof HERO_ASPECTS)[number];

/** split(사용/benefit) 섹션 이미지 종횡비 — 레퍼런스 사양 "split 4:5" */
export const SPLIT_ASPECTS = ["4:5"] as const;
export type SplitAspectId = (typeof SPLIT_ASPECTS)[number];

/** gallery 셀 종횡비 — 레퍼런스 사양 "gallery square/4:3" */
export const GALLERY_CELL_ASPECTS = ["square", "4:3"] as const;
export type GalleryCellAspectId = (typeof GALLERY_CELL_ASPECTS)[number];

/** gallery 밀도(열 수) */
export const GALLERY_DENSITIES = ["two-col", "three-col"] as const;
export type GalleryDensityId = (typeof GALLERY_DENSITIES)[number];

/** included/spec 섹션의 정보-이미지 그리드 배열 */
export const INCLUDED_GRID_LAYOUTS = ["info-left-image-right", "stacked"] as const;
export type IncludedGridLayoutId = (typeof INCLUDED_GRID_LAYOUTS)[number];

/** 헤드라인 정렬 — 레퍼런스 사양 "editorial left alignment 중심, 과도한 중앙정렬 금지" */
export const HEADLINE_ALIGNMENTS = ["left", "center"] as const;
export type HeadlineAlignmentId = (typeof HEADLINE_ALIGNMENTS)[number];

/** 섹션 간 세로 리듬 밀도 — px 값은 아래 테이블에서만 파생(72~120px 범위) */
export const SECTION_SPACINGS = ["compact", "standard", "spacious"] as const;
export type SectionSpacingId = (typeof SECTION_SPACINGS)[number];

/** 본문 한 줄의 최대 글자 수(ch 단위) 밀도 — 레퍼런스 사양 "maxTextMeasure" */
export const TEXT_MEASURES = ["narrow", "standard", "wide"] as const;
export type TextMeasureId = (typeof TEXT_MEASURES)[number];

export interface ResolvedComposition {
  family: CompositionFamilyId;
  hero: { aspect: HeroAspectId };
  split: { aspect: SplitAspectId };
  gallery: { cellAspect: GalleryCellAspectId; density: GalleryDensityId; columns: number };
  includedGrid: IncludedGridLayoutId;
  headlineAlignment: HeadlineAlignmentId;
  sectionSpacing: SectionSpacingId;
  sectionSpacingPx: number;
  textMeasure: TextMeasureId;
  maxTextMeasureCh: number;
}

const SECTION_SPACING_PX: Record<SectionSpacingId, number> = {
  compact: 72,
  standard: 96,
  spacious: 120,
};

const TEXT_MEASURE_CH: Record<TextMeasureId, number> = {
  narrow: 34,
  standard: 44,
  wide: 60,
};

/**
 * compositionFamily → 구조 토큰 고정 매핑(전부 검증된 enum·숫자 조합).
 * family 선택은 결정적 규칙(`design-director.ts`의 `selectCompositionFamily`)이
 * 하지만, family가 정해진 다음 나머지 구조 값까지 호출자가 임의로 섞을 수
 * 있게 두면 "검증된 numeric token으로만 제한" 요청 사양이 깨진다 — 그래서
 * family 하나마다 완결된 조합 하나만 존재한다.
 */
const COMPOSITION_FAMILY_TOKENS: Record<CompositionFamilyId, ResolvedComposition> = {
  "editorial-brochure": {
    family: "editorial-brochure",
    hero: { aspect: "4:3" },
    split: { aspect: "4:5" },
    gallery: { cellAspect: "square", density: "three-col", columns: 3 },
    includedGrid: "info-left-image-right",
    headlineAlignment: "left",
    sectionSpacing: "spacious",
    sectionSpacingPx: SECTION_SPACING_PX.spacious,
    textMeasure: "standard",
    maxTextMeasureCh: TEXT_MEASURE_CH.standard,
  },
  "technical-catalog": {
    family: "technical-catalog",
    hero: { aspect: "16:9" },
    split: { aspect: "4:5" },
    gallery: { cellAspect: "4:3", density: "two-col", columns: 2 },
    includedGrid: "stacked",
    headlineAlignment: "left",
    sectionSpacing: "standard",
    sectionSpacingPx: SECTION_SPACING_PX.standard,
    textMeasure: "narrow",
    maxTextMeasureCh: TEXT_MEASURE_CH.narrow,
  },
  "minimal-lifestyle": {
    family: "minimal-lifestyle",
    hero: { aspect: "4:3" },
    split: { aspect: "4:5" },
    gallery: { cellAspect: "square", density: "two-col", columns: 2 },
    includedGrid: "info-left-image-right",
    headlineAlignment: "center",
    sectionSpacing: "compact",
    sectionSpacingPx: SECTION_SPACING_PX.compact,
    textMeasure: "wide",
    maxTextMeasureCh: TEXT_MEASURE_CH.wide,
  },
  "gallery-forward": {
    family: "gallery-forward",
    hero: { aspect: "16:9" },
    split: { aspect: "4:5" },
    gallery: { cellAspect: "square", density: "three-col", columns: 3 },
    includedGrid: "info-left-image-right",
    headlineAlignment: "left",
    sectionSpacing: "standard",
    sectionSpacingPx: SECTION_SPACING_PX.standard,
    textMeasure: "standard",
    maxTextMeasureCh: TEXT_MEASURE_CH.standard,
  },
  "bold-statement": {
    family: "bold-statement",
    hero: { aspect: "4:3" },
    split: { aspect: "4:5" },
    gallery: { cellAspect: "square", density: "two-col", columns: 2 },
    includedGrid: "stacked",
    headlineAlignment: "center",
    sectionSpacing: "spacious",
    sectionSpacingPx: SECTION_SPACING_PX.spacious,
    textMeasure: "wide",
    maxTextMeasureCh: TEXT_MEASURE_CH.wide,
  },
  "compact-utility": {
    family: "compact-utility",
    hero: { aspect: "16:9" },
    split: { aspect: "4:5" },
    gallery: { cellAspect: "4:3", density: "two-col", columns: 2 },
    includedGrid: "stacked",
    headlineAlignment: "left",
    sectionSpacing: "compact",
    sectionSpacingPx: SECTION_SPACING_PX.compact,
    textMeasure: "narrow",
    maxTextMeasureCh: TEXT_MEASURE_CH.narrow,
  },
};

/**
 * compositionFamily(결정적 규칙이 고른 값) → 구조 토큰. family가
 * 없거나(undefined) 목록 밖 값이면 `editorial-brochure`로 안전하게
 * fallback한다 — 현재 benchmark 제품(가정용 호스 분사기류) 특성상
 * editorial-brochure가 기본으로 선택되도록 설계된 것과 일치한다.
 */
export function resolveComposition(family?: CompositionFamilyId | null): ResolvedComposition {
  if (family && COMPOSITION_FAMILY_TOKENS[family]) return COMPOSITION_FAMILY_TOKENS[family];
  return COMPOSITION_FAMILY_TOKENS["editorial-brochure"];
}

/**
 * Design Director(AI)가 실제로 출력해야 하는 JSON 형태 — 전부 위 enum
 * 값이거나 짧은 서술 문자열이다. 임의의 hex·px·CSS는 여기 없다.
 */
export interface DesignDirectorChoice {
  visualStyle: VisualStyleFamily;
  colorway: ColorwayId;
  /** 왜 이 스타일/컬러웨이를 골랐는지 — 제품 소재·색상·사용환경·브랜드 톤 근거 (한 문장) */
  rationale: string;
  typography: {
    headingWeight: HeadingWeight;
    letterSpacing: LetterSpacingId;
    lineHeight: LineHeightId;
    numericStyle: NumericStyleId;
    accentTypeface: AccentTypefaceId;
  };
  iconStyle: {
    family: IconFamilyId;
    strokeWidth: IconStrokeWidthId;
    cornerStyle: IconCornerStyleId;
    opticalSize: IconOpticalSizeId;
  };
  cardStyle: {
    variant: CardVariantId;
    radius: CardRadiusId;
  };
  graphicMotif: {
    family: GraphicMotifFamilyId;
    intensity: GraphicMotifIntensityId;
  };
  spacingDensity: SpacingDensityId;
  imageTreatment: {
    backgroundTreatment: ImageBackgroundTreatmentId;
  };
  accentUsage: AccentUsageId;
  /** 이 제품에는 쓰지 않기로 한 것(선택, 근거 기록용) — 사실을 지어내지 않는다, 빈 배열 허용 */
  avoid: string[];
}

// ── 2. Colorway 토큰 테이블 — resolveDesignProfile이 값을 채우는 유일한 출처 ──

interface ColorwayRoleTokens {
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  accentColor: string;
  neutralColor: string;
  backgroundColor: string;
  surfaceColor: string;
  headingColor: string;
  bodyColor: string;
  textOnAccent: string;
}

// 경고/주의 색은 style family와 무관하게 항상 같다(`#92400e`,
// `product-story-design.ts`의 `LAYOUT_VISUAL_TOKENS.notice`) — 사용자가
// 위험·주의 정보를 색으로 즉시 인식할 수 있어야 하므로(웹 표준 관습),
// 스타일 개인화 대상에서 제외한다(T1-163 이전부터의 관행과 동일한 판단).
// `layoutAccent`에 "notice" 키를 만들지 않는 것으로 이를 강제한다 —
// `resolveDesignProfile` 참고.

const COLORWAY_TOKENS: Record<ColorwayId, ColorwayRoleTokens> = {
  "harbor-steel": {
    primaryColor: "#0f766e",
    secondaryColor: "#0369a1",
    tertiaryColor: "#6d28d9",
    accentColor: "#4338ca",
    neutralColor: "#475569",
    backgroundColor: "#f2f5f9",
    surfaceColor: "#ffffff",
    headingColor: "#0f172a",
    bodyColor: "#334155",
    textOnAccent: "#f8fafc",
  },
  "graphite-cobalt": {
    primaryColor: "#1d4ed8",
    secondaryColor: "#0e7490",
    tertiaryColor: "#6d28d9",
    accentColor: "#1e3a8a",
    neutralColor: "#52525b",
    backgroundColor: "#f4f4f5",
    surfaceColor: "#ffffff",
    headingColor: "#18181b",
    bodyColor: "#3f3f46",
    textOnAccent: "#f8fafc",
  },
  "ink-paper": {
    primaryColor: "#57534e",
    secondaryColor: "#92400e",
    tertiaryColor: "#44403c",
    accentColor: "#78350f",
    neutralColor: "#57534e",
    backgroundColor: "#faf9f7",
    surfaceColor: "#ffffff",
    headingColor: "#1c1917",
    bodyColor: "#44403c",
    textOnAccent: "#fdf6ec",
  },
  "charcoal-mono": {
    primaryColor: "#3f3f46",
    secondaryColor: "#27272a",
    tertiaryColor: "#52525b",
    accentColor: "#b91c1c",
    neutralColor: "#52525b",
    backgroundColor: "#f8f8f7",
    surfaceColor: "#ffffff",
    headingColor: "#18181b",
    bodyColor: "#3f3f46",
    textOnAccent: "#ffffff",
  },
  "forest-lime": {
    primaryColor: "#166534",
    secondaryColor: "#3f6212",
    tertiaryColor: "#115e59",
    accentColor: "#365314",
    neutralColor: "#44403c",
    backgroundColor: "#f6f8f2",
    surfaceColor: "#ffffff",
    headingColor: "#14532d",
    bodyColor: "#365314",
    textOnAccent: "#f7fee7",
  },
  "slate-amber": {
    primaryColor: "#334155",
    secondaryColor: "#b45309",
    tertiaryColor: "#475569",
    accentColor: "#92400e",
    neutralColor: "#475569",
    backgroundColor: "#f1f5f9",
    surfaceColor: "#ffffff",
    headingColor: "#1e293b",
    bodyColor: "#334155",
    textOnAccent: "#fffbeb",
  },
  "blush-mauve": {
    primaryColor: "#9d174d",
    secondaryColor: "#86198f",
    tertiaryColor: "#6b21a8",
    accentColor: "#9d174d",
    neutralColor: "#78716c",
    backgroundColor: "#fdf5f8",
    surfaceColor: "#ffffff",
    headingColor: "#3f1d2e",
    bodyColor: "#6b4557",
    textOnAccent: "#fff5f8",
  },
  "sage-cream": {
    primaryColor: "#3f6212",
    secondaryColor: "#78350f",
    tertiaryColor: "#0f766e",
    accentColor: "#3f6212",
    neutralColor: "#57534e",
    backgroundColor: "#f7f5ee",
    surfaceColor: "#ffffff",
    headingColor: "#33392f",
    bodyColor: "#54594c",
    textOnAccent: "#fbfaf3",
  },
  "carbon-crimson": {
    primaryColor: "#18181b",
    secondaryColor: "#3f3f46",
    tertiaryColor: "#52525b",
    accentColor: "#b91c1c",
    neutralColor: "#52525b",
    backgroundColor: "#f4f4f5",
    surfaceColor: "#ffffff",
    headingColor: "#09090b",
    bodyColor: "#27272a",
    textOnAccent: "#fff1f1",
  },
  "navy-electric": {
    primaryColor: "#1e3a8a",
    secondaryColor: "#1d4ed8",
    tertiaryColor: "#0369a1",
    accentColor: "#1e3a8a",
    neutralColor: "#334155",
    backgroundColor: "#f1f5fb",
    surfaceColor: "#ffffff",
    headingColor: "#0b1220",
    bodyColor: "#1e293b",
    textOnAccent: "#f5f9ff",
  },
};

// ── 3. WCAG 대비 가드레일 — AI가 고른 값이 아니라 이 표 자체를 검증한다 ──

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** hex(#rrggbb) → 상대 휘도(WCAG 2.1 공식) */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return 0;
  const value = Number.parseInt(match[1], 16);
  const r = srgbChannelToLinear((value >> 16) & 0xff);
  const g = srgbChannelToLinear((value >> 8) & 0xff);
  const b = srgbChannelToLinear(value & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 두 hex 색의 WCAG 2.1 대비비 (1~21) */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ColorwayContrastReport {
  colorwayId: ColorwayId;
  headingOnBackground: number;
  bodyOnBackground: number;
  textOnAccentVsAccent: number;
  /** WCAG AA 본문 기준(4.5:1) — heading/body 대 배경, textOnAccent 대 accentColor 모두 통과해야 true */
  passesAA: boolean;
}

const WCAG_AA_NORMAL_TEXT = 4.5;

/** 이 colorway가 접근성 대비 가드레일을 통과하는지 — 런타임/테스트 양쪽에서 쓴다 */
export function checkColorwayContrastGuardrail(colorwayId: ColorwayId): ColorwayContrastReport {
  const tokens = COLORWAY_TOKENS[colorwayId];
  const headingOnBackground = contrastRatio(tokens.headingColor, tokens.backgroundColor);
  const bodyOnBackground = contrastRatio(tokens.bodyColor, tokens.backgroundColor);
  const textOnAccentVsAccent = contrastRatio(tokens.textOnAccent, tokens.accentColor);
  return {
    colorwayId,
    headingOnBackground,
    bodyOnBackground,
    textOnAccentVsAccent,
    passesAA:
      headingOnBackground >= WCAG_AA_NORMAL_TEXT &&
      bodyOnBackground >= WCAG_AA_NORMAL_TEXT &&
      textOnAccentVsAccent >= WCAG_AA_NORMAL_TEXT,
  };
}

// ── 4. 타이포그래피/아이콘/카드/모티프 프리셋 해석 테이블 ──────────────

const KOREAN_SAFE_STACK =
  '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const KOREAN_DISPLAY_STACK = `"Pretendard Variable", "Pretendard", ${KOREAN_SAFE_STACK}`;

const ACCENT_TYPEFACE_STACKS: Record<AccentTypefaceId, { numeric: string; accent: string }> = {
  "technical-grotesk": {
    numeric: `"Bahnschrift", "Segoe UI Semibold", ${KOREAN_SAFE_STACK}`,
    accent: `"Bahnschrift", "Segoe UI Semibold", ${KOREAN_SAFE_STACK}`,
  },
  "editorial-serif": {
    numeric: `"Bahnschrift", "Segoe UI Semibold", ${KOREAN_SAFE_STACK}`,
    accent: `"Georgia", "Times New Roman", ${KOREAN_SAFE_STACK}`,
  },
  "rounded-sans": {
    numeric: `"Segoe UI Semibold", "Bahnschrift", ${KOREAN_SAFE_STACK}`,
    accent: `"Segoe UI Semibold", "Segoe UI", ${KOREAN_SAFE_STACK}`,
  },
};

const LETTER_SPACING_VALUES: Record<LetterSpacingId, string> = {
  tight: "-0.02em",
  normal: "-0.01em",
  wide: "0.01em",
};

const LINE_HEIGHT_VALUES: Record<LineHeightId, string> = {
  compact: "1.3",
  comfortable: "1.5",
  relaxed: "1.7",
};

const ICON_STROKE_WIDTH_VALUES: Record<IconStrokeWidthId, number> = {
  thin: 1.5,
  regular: 2,
  bold: 3,
};

const ICON_OPTICAL_SIZE_VALUES: Record<IconOpticalSizeId, number> = {
  compact: 12,
  standard: 14,
  large: 17,
};

const CARD_RADIUS_VALUES: Record<CardRadiusId, { sm: string; md: string; lg: string; xl: string }> = {
  sharp: { sm: "4px", md: "8px", lg: "12px", xl: "16px" },
  soft: { sm: "10px", md: "18px", lg: "28px", xl: "36px" },
  round: { sm: "14px", md: "24px", lg: "36px", xl: "48px" },
};

const CARD_VARIANT_VALUES: Record<
  CardVariantId,
  { shadowCard: string; borderColorAlpha: number; borderColorStrongAlpha: number }
> = {
  flat: { shadowCard: "none", borderColorAlpha: 0.1, borderColorStrongAlpha: 0.18 },
  outlined: { shadowCard: "none", borderColorAlpha: 0.16, borderColorStrongAlpha: 0.28 },
  elevated: { shadowCard: "0 24px 52px -28px rgba(15, 23, 42, 0.28)", borderColorAlpha: 0.06, borderColorStrongAlpha: 0.12 },
  "soft-shadow": { shadowCard: "0 20px 44px -26px rgba(15, 23, 42, 0.18)", borderColorAlpha: 0.08, borderColorStrongAlpha: 0.16 },
};

const SPACING_DENSITY_VALUES: Record<SpacingDensityId, string> = {
  compact: "6px",
  standard: "8px",
  spacious: "11px",
};

const IMAGE_BACKGROUND_TREATMENT_VALUES: Record<ImageBackgroundTreatmentId, (surfaceColor: string) => string> = {
  "letterbox-neutral": () => "linear-gradient(160deg, #f8f9fb 0%, #eef1f6 100%)",
  "letterbox-tinted": (surfaceColor) => `linear-gradient(160deg, ${surfaceColor} 0%, rgba(15, 23, 42, 0.04) 100%)`,
  none: () => "transparent",
};

/**
 * 전부 한 겹짜리(single-layer) 패턴이다 — closing 섹션 배경은 이 패턴 위에
 * 항상 같은 다크 네이비 linear-gradient를 한 겹 더 얹는데(렌더러,
 * `product-story-html.ts`), `background-size` 목록 길이를 패턴 수마다
 * 다르게 관리하지 않기 위해 의도적으로 모든 family를 1겹으로 제한했다.
 * "technical-grid"는 두 축을 다 그리는 진짜 격자 대신 촘촘한 가로줄로
 * 단순화했다(2겹 격자를 넣으면 background-size 배열이 family마다
 * 달라져야 해서 복잡도가 커진다) — 근사이지 격자가 전혀 아닌 것은 아니다.
 */
const GRAPHIC_MOTIF_BACKGROUND: Record<Exclude<GraphicMotifFamilyId, "none">, string> = {
  "dot-grid": "radial-gradient(currentColor 1px, transparent 1px)",
  "corner-line": "repeating-linear-gradient(90deg, currentColor 0, currentColor 1px, transparent 1px, transparent 18px)",
  "diagonal-cut": "repeating-linear-gradient(135deg, currentColor 0, currentColor 1px, transparent 1px, transparent 14px)",
  "technical-grid": "repeating-linear-gradient(0deg, currentColor 0, currentColor 1px, transparent 1px, transparent 18px)",
};

const GRAPHIC_MOTIF_INTENSITY_OPACITY: Record<GraphicMotifIntensityId, number> = {
  none: 0,
  subtle: 0.04,
  medium: 0.07,
};

// ── 5. 완전히 해석된(resolved) 결과 ────────────────────────────────

/** `familyIconMarkup()`이 고른 SVG 문자열에 그대로 치환해 적용할 아이콘 스타일(T1-177: family가 최종 렌더링을 결정한다) */
export interface ResolvedIconStyle {
  family: IconFamilyId;
  strokeWidth: number;
  size: number;
  linecap: "round" | "square";
  linejoin: "round" | "miter";
}

export interface ResolvedMotif {
  family: GraphicMotifFamilyId;
  intensity: GraphicMotifIntensityId;
  opacity: number;
  backgroundImage: string;
}

/** `--pde-heading-*` CSS 변수로 그대로 흘러가는 값(`product-story-html.ts`의 `.pde-story-summary p`) — 페이지 최상단 "헤딩" 역할 텍스트에만 적용한다(closing 사인오프는 별도 극적 톤을 유지, 이 값을 쓰지 않는다) */
export interface ResolvedTypographyDetail {
  headingWeight: number;
  letterSpacing: string;
  lineHeight: string;
  numericStyle: NumericStyleId;
}

export interface ResolvedDesignProfile {
  /** 결정적 식별자 — 같은 choice면 항상 같은 id (감사·캐시 무효화 판단용) */
  id: string;
  visualStyle: VisualStyleFamily;
  colorway: ColorwayId;
  rationale: string;
  avoid: string[];
  accentUsage: AccentUsageId;
  spacingDensity: SpacingDensityId;
  cardVariant: CardVariantId;
  imageBackgroundTreatment: ImageBackgroundTreatmentId;
  /** `buildStoryVisualTokens(masterContract, tokens)`에 그대로 넘기는 override */
  tokens: Partial<StoryVisualDesignTokens>;
  /** `planStoryDesign`이 typography로 그대로 대체하는 값 */
  typography: StoryTypography;
  typographyDetail: ResolvedTypographyDetail;
  /** layout → accentColor(hex). notice는 항상 고정색이라 이 표에 없다 */
  layoutAccent: Partial<Record<StoryLayoutVariant, string>>;
  icon: ResolvedIconStyle;
  motif: ResolvedMotif;
  /** T1-183 — hero/split/gallery/included grid/section rhythm 구조 토큰 */
  composition: ResolvedComposition;
}

const LAYOUT_ROLE_MAP: Record<Exclude<StoryLayoutVariant, "notice">, keyof ColorwayRoleTokens> = {
  "spec-panel": "secondaryColor",
  "step-by-step": "accentColor",
  "feature-highlight": "primaryColor",
  "problem-empathy": "neutralColor",
  "detail-callout": "secondaryColor",
  "components-grid": "tertiaryColor",
  "image-feature": "primaryColor",
  "image-text": "primaryColor",
  "text-only": "neutralColor",
  closing: "secondaryColor",
};

/** 검증 실패 시 colorway를 대체할 안전한 기본값(family 안에서 첫 번째 등록된 값) */
function safeColorwayFor(family: VisualStyleFamily, colorway: ColorwayId): ColorwayId {
  const allowed = FAMILY_COLORWAYS[family];
  if (allowed.includes(colorway)) {
    const report = checkColorwayContrastGuardrail(colorway);
    if (report.passesAA) return colorway;
  }
  // 대비 가드레일을 통과하지 못했거나 family-colorway 조합이 허용 목록 밖이면
  // 그 family의 첫 번째(사전 검증된) colorway로 안전하게 대체한다.
  return allowed[0];
}

/**
 * Design Director(AI)의 선택(`DesignDirectorChoice`)을 렌더러가 바로 쓸 수
 * 있는 `ResolvedDesignProfile`로 변환한다. LLM 호출 없음 — 순수 함수,
 * 결정적(같은 choice → 항상 같은 결과). 컬러웨이가 접근성 가드레일을
 * 통과하지 못하면(이 저장소가 미리 검증해 둔 10개 중 하나이므로 정상
 * 경로에서는 항상 통과하지만, 방어적으로) family의 안전한 기본
 * colorway로 대체한다 — AI가 고른 값을 조용히 무시하지 않고 왜
 * 대체됐는지 `rationale`에 덧붙인다.
 */
export function resolveDesignProfile(
  choice: DesignDirectorChoice,
  /**
   * T1-183 — 제품 특성 기반 결정적 규칙(`design-director.ts`의
   * `selectCompositionFamily`)이 고른 composition family. 지정하지
   * 않으면(undefined/null, 기존 호출부 하위 호환) `resolveComposition`이
   * 안전한 기본값(editorial-brochure)으로 처리한다 — 이 함수 자체는
   * family를 스스로 판단하지 않는다(결정 로직과 토큰 변환을 분리).
   */
  compositionFamily?: CompositionFamilyId | null,
): ResolvedDesignProfile {
  const resolvedColorway = safeColorwayFor(choice.visualStyle, choice.colorway);
  const substituted = resolvedColorway !== choice.colorway;
  const roles = COLORWAY_TOKENS[resolvedColorway];

  const layoutAccent: Partial<Record<StoryLayoutVariant, string>> = {};
  for (const [layout, role] of Object.entries(LAYOUT_ROLE_MAP) as [Exclude<StoryLayoutVariant, "notice">, keyof ColorwayRoleTokens][]) {
    layoutAccent[layout] = roles[role];
  }

  const accentStacks = ACCENT_TYPEFACE_STACKS[choice.typography.accentTypeface];
  const typography: StoryTypography = {
    display: KOREAN_DISPLAY_STACK,
    body: KOREAN_SAFE_STACK,
    emphasis: KOREAN_DISPLAY_STACK,
    numeric: choice.typography.numericStyle === "tabular" ? accentStacks.numeric : KOREAN_SAFE_STACK,
    accent: accentStacks.accent,
  };

  const radii = CARD_RADIUS_VALUES[choice.cardStyle.radius];
  const cardVariant = CARD_VARIANT_VALUES[choice.cardStyle.variant];
  const spacingUnit = SPACING_DENSITY_VALUES[choice.spacingDensity];
  const backgroundTreatment = IMAGE_BACKGROUND_TREATMENT_VALUES[choice.imageTreatment.backgroundTreatment](
    roles.surfaceColor,
  );

  const accentGradient = `linear-gradient(120deg, ${roles.primaryColor} 0%, ${roles.secondaryColor} 55%, ${roles.accentColor} 100%)`;

  const tokens: Partial<StoryVisualDesignTokens> = {
    pageBackground: `radial-gradient(130% 120% at 15% -10%, ${roles.backgroundColor} 0%, ${roles.surfaceColor} 60%, ${roles.backgroundColor} 100%)`,
    surfaceBackgroundA: roles.surfaceColor,
    surfaceBackgroundB: roles.backgroundColor,
    panelBackground: roles.surfaceColor,
    imageFrameBackground: backgroundTreatment,
    borderColor: `rgba(15, 23, 42, ${cardVariant.borderColorAlpha})`,
    borderColorStrong: `rgba(15, 23, 42, ${cardVariant.borderColorStrongAlpha})`,
    textPrimary: roles.headingColor,
    textSecondary: roles.bodyColor,
    textMuted: roles.bodyColor,
    textOnAccent: roles.textOnAccent,
    accentGradient,
    accentGradientSoft: `linear-gradient(135deg, ${roles.secondaryColor}22, ${roles.accentColor}1a)`,
    radiusSm: radii.sm,
    radiusMd: radii.md,
    radiusLg: radii.lg,
    radiusXl: radii.xl,
    shadowCard: cardVariant.shadowCard,
    shadowGlow: `0 0 0 1px rgba(15, 23, 42, ${cardVariant.borderColorAlpha}), 0 0 32px -10px ${roles.accentColor}44`,
    spacingUnit,
    iconBadgeBorder: `rgba(15, 23, 42, ${cardVariant.borderColorAlpha})`,
  };

  const motifFamily = choice.graphicMotif.family;
  const opacity = GRAPHIC_MOTIF_INTENSITY_OPACITY[choice.graphicMotif.intensity];
  const motif: ResolvedMotif = {
    family: motifFamily,
    intensity: choice.graphicMotif.intensity,
    opacity: motifFamily === "none" ? 0 : opacity,
    backgroundImage: motifFamily === "none" ? "none" : GRAPHIC_MOTIF_BACKGROUND[motifFamily],
  };

  const icon: ResolvedIconStyle = {
    family: choice.iconStyle.family,
    strokeWidth: ICON_STROKE_WIDTH_VALUES[choice.iconStyle.strokeWidth],
    size: ICON_OPTICAL_SIZE_VALUES[choice.iconStyle.opticalSize],
    linecap: choice.iconStyle.cornerStyle === "rounded" ? "round" : "square",
    linejoin: choice.iconStyle.cornerStyle === "rounded" ? "round" : "miter",
  };

  const typographyDetail: ResolvedTypographyDetail = {
    headingWeight: Number(choice.typography.headingWeight),
    letterSpacing: LETTER_SPACING_VALUES[choice.typography.letterSpacing],
    lineHeight: LINE_HEIGHT_VALUES[choice.typography.lineHeight],
    numericStyle: choice.typography.numericStyle,
  };

  const rationale = substituted
    ? `${choice.rationale} (안내: 요청한 컬러웨이가 접근성 대비 기준을 통과하지 못해 같은 계열의 검증된 컬러웨이로 대체됨)`
    : choice.rationale;

  return {
    id: `design-profile:${choice.visualStyle}:${resolvedColorway}:v1`,
    visualStyle: choice.visualStyle,
    colorway: resolvedColorway,
    rationale,
    avoid: choice.avoid,
    accentUsage: choice.accentUsage,
    spacingDensity: choice.spacingDensity,
    cardVariant: choice.cardStyle.variant,
    imageBackgroundTreatment: choice.imageTreatment.backgroundTreatment,
    tokens,
    typography,
    typographyDetail,
    layoutAccent,
    icon,
    motif,
    composition: resolveComposition(compositionFamily),
  };
}

// ── 6. 검증 (수동 파서 — 이 프로젝트의 기존 공식 방식, product-story.ts의
//      parseProductStoryResponse와 같은 패턴을 따른다. zod 등 외부
//      라이브러리는 이 저장소에 의존성으로 없다.) ──────────────────────

export class DesignProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignProfileParseError";
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function requireEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = record[key];
  if (!isOneOf(value, allowed)) {
    throw new DesignProfileParseError(
      `"${key}" 값이 허용된 목록(${allowed.join(", ")}) 안에 없습니다: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireObject(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DesignProfileParseError(`"${key}"는 객체여야 합니다.`);
  }
  return value as Record<string, unknown>;
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

/**
 * LLM 응답 텍스트 → `DesignDirectorChoice`. 구조·어휘(enum 소속)만
 * 검증한다 — 형식이 허용된 범위를 벗어나면 즉시 `DesignProfileParseError`를
 * 던진다(호출자는 이걸 잡아 기존 baseline 렌더링으로 fallback한다,
 * `apps/api/src/product-profile/product-profile.service.ts`).
 */
export function parseDesignDirectorResponse(text: string): DesignDirectorChoice {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new DesignProfileParseError("LLM 응답에서 JSON 객체를 찾을 수 없습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new DesignProfileParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DesignProfileParseError("LLM 응답이 JSON 객체 형태가 아닙니다.");
  }
  const record = parsed as Record<string, unknown>;

  const visualStyle = requireEnum(record, "visualStyle", VISUAL_STYLE_FAMILIES);
  const colorway = requireEnum(record, "colorway", COLORWAY_IDS);
  if (!FAMILY_COLORWAYS[visualStyle].includes(colorway)) {
    throw new DesignProfileParseError(
      `colorway "${colorway}"는 visualStyle "${visualStyle}"에 허용된 목록(${FAMILY_COLORWAYS[visualStyle].join(", ")})에 없습니다.`,
    );
  }
  const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
  if (!rationale) {
    throw new DesignProfileParseError('"rationale"이 비어 있습니다.');
  }

  const typographyRecord = requireObject(record, "typography");
  const typography = {
    headingWeight: requireEnum(typographyRecord, "headingWeight", HEADING_WEIGHTS),
    letterSpacing: requireEnum(typographyRecord, "letterSpacing", LETTER_SPACINGS),
    lineHeight: requireEnum(typographyRecord, "lineHeight", LINE_HEIGHTS),
    numericStyle: requireEnum(typographyRecord, "numericStyle", NUMERIC_STYLES),
    accentTypeface: requireEnum(typographyRecord, "accentTypeface", ACCENT_TYPEFACES),
  };

  const iconRecord = requireObject(record, "iconStyle");
  const iconStyle = {
    family: requireEnum(iconRecord, "family", ICON_FAMILIES),
    strokeWidth: requireEnum(iconRecord, "strokeWidth", ICON_STROKE_WIDTHS),
    cornerStyle: requireEnum(iconRecord, "cornerStyle", ICON_CORNER_STYLES),
    opticalSize: requireEnum(iconRecord, "opticalSize", ICON_OPTICAL_SIZES),
  };

  const cardRecord = requireObject(record, "cardStyle");
  const cardStyle = {
    variant: requireEnum(cardRecord, "variant", CARD_VARIANTS),
    radius: requireEnum(cardRecord, "radius", CARD_RADII),
  };

  const motifRecord = requireObject(record, "graphicMotif");
  const graphicMotif = {
    family: requireEnum(motifRecord, "family", GRAPHIC_MOTIF_FAMILIES),
    intensity: requireEnum(motifRecord, "intensity", GRAPHIC_MOTIF_INTENSITIES),
  };

  const spacingDensity = requireEnum(record, "spacingDensity", SPACING_DENSITIES);

  const imageTreatmentRecord = requireObject(record, "imageTreatment");
  const imageTreatment = {
    backgroundTreatment: requireEnum(imageTreatmentRecord, "backgroundTreatment", IMAGE_BACKGROUND_TREATMENTS),
  };

  const accentUsage = requireEnum(record, "accentUsage", ACCENT_USAGES);
  const avoid = optionalStringArray(record.avoid);

  return {
    visualStyle,
    colorway,
    rationale,
    typography,
    iconStyle,
    cardStyle,
    graphicMotif,
    spacingDensity,
    imageTreatment,
    accentUsage,
    avoid,
  };
}
