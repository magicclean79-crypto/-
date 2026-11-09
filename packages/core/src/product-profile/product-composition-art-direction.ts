import type { ImageCategory } from "@acos/shared";

/**
 * Section Composition — Art Direction Contract. (T1-149)
 *
 * 기존 방식은 카테고리마다 한 줄짜리 지시(`CATEGORY_PROMPTS`,
 * `apps/api/src/image-gen/image-gen.service.ts`)만 Gemini에 넘겼다 —
 * "이 제품의 대표 Hero 이미지를 만들어줘" 같은 한 문장으로는 방금 승인된
 * 프리미엄 호스 세트 시안 수준의 **하나의 완성된 광고 composition**이
 * 나오지 않는다(사장님 결정, T1-149 요청 원문).
 *
 * 이 파일은 그 한 줄 지시를 대체하는 **Art Direction Contract**를
 * 정의한다 — canvas 비율·시각적 초점·제품 배치·카메라/조명·배경·팔레트·
 * 타이포그래피 역할·아이콘 역할·여백·이미지 장수·카피 역할·CTA를
 * 명시적으로 못 박는다. LLM 호출 없음 — 순수 함수(결정적, 같은 입력 →
 * 같은 계약).
 *
 * ## 원칙
 *
 * - **정확한 상품 정보 텍스트를 이미지 글자로 요청하지 않는다.** 이
 *   계약은 항상 "이미지 자체에는 글자를 그리지 않는다 — 정확한 문구는
 *   HTML로 오버레이된다"는 지시를 포함한다(요청 사양 7).
 * - **제품 구조·색·재질·구성품을 발명/변형하지 않는다.** 계약은 항상
 *   기존 `PRODUCT_IDENTITY_RULES`(`product-package.ts`)와 함께 쓰이는
 *   보조 지시일 뿐, 그 최우선 규칙을 대체하지 않는다 —
 *   `buildImageGenerationPrompt`가 여전히 이 instruction 앞에 제품
 *   동일성 규칙을 놓는다.
 * - 팔레트는 승인된 프리미엄 호스 세트 시안 기준(white/soft neutral 배경
 *   + teal/blue 액센트 + dark typography)을 canonical benchmark로
 *   고정한다 — 카테고리마다 명도만 다르게 써서 페이지 전체가 하나의
 *   색 언어로 이어지게 한다(`product-story-design.ts`의
 *   `LAYOUT_VISUAL_TOKENS`와 같은 teal/blue 계열).
 */

export interface SectionCompositionContract {
  /** 결정적 식별자 — 같은 카테고리·같은 계약 버전이면 항상 같은 값 (요청 사양 8) */
  contractId: string;
  category: ImageCategory;
  /** 이 composition이 속한 Master Art Direction Contract id (T1-153) — 모든 섹션이 같은 값을 공유해야 팔레트/타이포/아이콘 언어가 페이지 전체에서 흔들리지 않는다 */
  masterContractId: string;
  /** 이 composition이 상세페이지 안에서 차지하는 자리 — sectionId 없이 category만으로는 같은 category를 쓰는 여러 narrative role(예: USAGE_SCENE을 공유하는 USAGE/LIFESTYLE/HOW_TO)을 구분할 수 없다 (T1-153) */
  sectionId: string;
  /** 11개 표준 섹션 구조(T1-153 요청 사양)에서 이 composition이 맡는 서사 역할 */
  narrativeRole: SectionNarrativeRole;
  /** 이 composition이 상세페이지 서사에서 하는 역할 */
  purpose: string;
  canvasRatio: string;
  focalPoint: string;
  productPlacement: string;
  cameraLighting: string;
  /** 렌즈/카메라가 만드는 인상(예: 망원 압축감 vs 광각 개방감) — cameraLighting의 조명 설명과 별개로 카메라 언어를 명시 (T1-153) */
  lensFeeling: string;
  /** 실제로 잘려나가는 프레이밍 지시 — canvasRatio(비율)와 별개로 "어디를 자를지"를 못 박는다 (T1-153) */
  crop: string;
  background: string;
  palette: string;
  typographyRole: string;
  iconRole: string;
  whitespace: string;
  /** 텍스트 오버레이가 절대 침범하면 안 되는 영역 — whitespace/typographyRole을 렌더러가 그대로 좌표로 쓸 수 있게 명시 (T1-153) */
  textSafeArea: string;
  /** 이미지 안 요소들의 배치 규칙(그리드/삼분할/대각선 등) (T1-153) */
  compositionGeometry: string;
  /** 무엇이 가장 먼저 보여야 하고 무엇이 보조로 물러나야 하는지 (T1-153) */
  visualHierarchy: string;
  imageCount: number;
  copyRole: string;
  cta: string;
  /** 이 composition이 참조해야 할 실제 제품 사진의 우선순위 안내 */
  referenceHierarchyGuidance: string;
  /** 이 composition을 만들 때 실제로 참조로 전달된 이미지 id — 호출자(image-gen)가 채운다. 계약 자체는 순수 함수라 DB를 모르므로 기본값은 빈 배열 (T1-153) */
  requiredReferenceIds: string[];
  /** 이 섹션에만 해당하는 사용자 요구사항 원문(있으면) — 무엇이 실제로 이 계약에 반영됐는지 추적 (T1-153) */
  sectionUserRequirements: string | null;
  negativeGuardrails: string;
}

/**
 * Master Art Direction Contract — 페이지 전체가 공유하는 시각 언어 (T1-153).
 *
 * 기존에도 팔레트(`CANONICAL_PALETTE`)는 모든 카테고리가 이미 공유하고
 * 있었지만 "공유하고 있다는 사실" 자체가 명시적 객체로 존재하지 않았다 —
 * 각 `SectionCompositionContract`가 우연히 같은 상수를 참조할 뿐이었다.
 * 이 함수는 그 공유 관계를 하나의 버전 있는 id로 못 박아, 모든 섹션
 * 계약이 `masterContractId`로 "나는 이 마스터 계약에서 파생됐다"를
 * 선언하게 한다 — 이후 어느 섹션이 마스터 언어에서 벗어났는지(예: 다른
 * 팔레트·다른 CTA 언어를 쓴) 기계적으로 비교할 수 있다.
 */
export interface MasterArtDirectionContract {
  contractId: string;
  palette: string;
  typographyRoles: string;
  iconLanguage: string;
  spacingRhythm: string;
  gridSystem: string;
  imageTreatment: string;
  lighting: string;
  cameraLanguage: string;
  borderRadiusShadow: string;
  backgroundTreatment: string;
  ctaLanguage: string;
  /**
   * 상세페이지 HTML 셸(페이지 배경·카드·패널)의 색 언어 — 위
   * `backgroundTreatment`는 **실제 제품 사진의 스튜디오 배경**(이미지
   * 생성 지시)이고, 이 필드는 그 사진들을 담는 **웹페이지 컨테이너
   * 자체**의 art direction이다(T1-162, T1-163에서 밝은 팔레트로 갱신).
   * 이 둘은 서로 다른 레이어라 독립적으로 바뀔 수 있다 — 제품 사진은
   * 계속 화이트~뉴트럴 스튜디오 톤을 유지하면서(재촬영 비용·제품
   * 동일성 위험 없음), 페이지 셸만 독립적으로 바뀔 수 있다.
   */
  pageChrome: string;
}

const MASTER_ART_DIRECTION_VERSION = "v1";

/**
 * 상세페이지 HTML/CSS 렌더러가 실제로 소비하는 기계 판독 가능한 디자인
 * 토큰 (T1-162). `MasterArtDirectionContract`의 다른 필드들은 이미지
 * 생성 LLM에게 보내는 산문 지시문이라 렌더러가 그대로 쓸 수 없다 — 이
 * 인터페이스는 같은 Master Art Direction 한 벌(`tokensId`가
 * `masterContract.contractId`를 그대로 포함해 추적 가능)에서 파생된
 * 실제 CSS 값(hex·gradient·px)이다. `product-story-design.ts`(강조색
 * 팔레트)와 `product-story-html.ts`/`product-story-facts-panel.ts`
 * (배경·테두리·그림자·타이포)가 이 함수를 직접 호출해 값을 가져온다 —
 * 렌더러 세 파일이 색상값을 각자 하드코딩하던 것을 하나의 출처로
 * 모은다. LLM 호출 없음 — 순수 함수, 결정적.
 */
export interface StoryVisualDesignTokens {
  tokensId: string;
  /** 페이지 전체 배경 — warm/cool off-white radial gradient (T1-163, 다크 네이비에서 전환) */
  pageBackground: string;
  /** 섹션이 번갈아 쓰는 두 가지 밝은 톤(A/B) — 얇은 테두리 대신 톤 차이로 리듬을 만든다 */
  surfaceBackgroundA: string;
  surfaceBackgroundB: string;
  /** 카드·패널(기능 카드·구성품 카드·사양 패널)의 표면 배경 — 흰색, 테두리·그림자로 페이지 배경과 구분한다 */
  panelBackground: string;
  /** contain-fit 제품 사진 주변을 채우는 letterbox 배경 — 잘림 없이도 여백이 어색하지 않게, 밝은 뉴트럴 톤 */
  imageFrameBackground: string;
  borderColor: string;
  borderColorStrong: string;
  /** 짙은 네이비 — 밝은 배경 위 본문 타이포그래피 (T1-163) */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** 채워진 accent 배지/필(pill) 위에 얹는 텍스트 — accentColor가 항상 밝은 배경에서도 읽히는 진한 톤(700급)이라, 그 위에서는 밝은 텍스트가 필요하다(T1-163) */
  textOnAccent: string;
  /** Display 헤드라인에 쓰는 gradient accent text — 밝은 배경에서도 대비가 살도록 진한 teal→blue→indigo 톤 */
  accentGradient: string;
  /** 아이콘 배지 뒤에 까는 은은한 glow */
  accentGradientSoft: string;
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusXl: string;
  shadowCard: string;
  shadowGlow: string;
  /** 여백 리듬의 기준 단위 — spacingRhythm(위 프로즈 지시)의 실제 배수 값 */
  spacingUnit: string;
  iconBadgeBorder: string;
}

/**
 * `masterContract`(지정하지 않으면 canonical 계약)에서 파생된 HTML 디자인
 * 토큰을 만든다. 페이지 셸(`pageChrome`)의 실제 CSS 값을 못 박는다 —
 * T1-162의 다크 네이비 프리미엄 방향은 사용자가 "화면이 너무 어둡다"고
 * 판단해(T1-163 요청 원문) 밝은 premium editorial commerce 방향으로
 * 바꾼다: warm/cool off-white·white·very light blue-gray를 주 배경으로
 * 쓰고, navy는 텍스트·강조·closing 같은 제한된 패널에만 남긴다. 색
 * 언어(teal/blue/indigo 계열 accent) 자체는 T1-162와 같은 계열을 더 진한
 * 톤(600~700급)으로 옮겨 유지한다 — 페이지가 밝아져도 "하나의 색 언어"
 * 원칙(T1-147)은 그대로다.
 */
export function buildStoryVisualTokens(
  masterContract: MasterArtDirectionContract = buildMasterArtDirectionContract(),
  /**
   * DESIGN_PROFILE(Design Director, T1-176)이 만든 제품별 override —
   * 지정하지 않으면 기존 baseline 값 그대로다(회귀 없음). 지정된 필드만
   * 덮어쓰고 나머지는 baseline을 그대로 쓴다 — `resolveDesignProfile`
   * (`design-profile.ts`)이 이 override 객체를 만든다.
   */
  overrides?: Partial<StoryVisualDesignTokens>,
): StoryVisualDesignTokens {
  return {
    tokensId: `${masterContract.contractId}:story-visual-tokens:v2`,
    pageBackground: "radial-gradient(130% 120% at 15% -10%, #f8f6f2 0%, #f2f5f9 46%, #eef1f6 100%)",
    surfaceBackgroundA: "#ffffff",
    surfaceBackgroundB: "#f2f5fa",
    panelBackground: "#ffffff",
    imageFrameBackground: "linear-gradient(160deg, #f8f9fb 0%, #eef1f6 100%)",
    borderColor: "rgba(15, 23, 42, 0.08)",
    borderColorStrong: "rgba(15, 23, 42, 0.16)",
    textPrimary: "#0f172a",
    textSecondary: "rgba(15, 23, 42, 0.66)",
    textMuted: "rgba(15, 23, 42, 0.48)",
    textOnAccent: "#f8fafc",
    accentGradient: "linear-gradient(120deg, #0f766e 0%, #2563eb 55%, #4f46e5 100%)",
    accentGradientSoft: "linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(79, 70, 229, 0.10))",
    radiusSm: "10px",
    radiusMd: "18px",
    radiusLg: "28px",
    radiusXl: "36px",
    shadowCard: "0 20px 44px -26px rgba(15, 23, 42, 0.18)",
    shadowGlow: "0 0 0 1px rgba(37, 99, 235, 0.14), 0 0 32px -10px rgba(37, 99, 235, 0.28)",
    spacingUnit: "8px",
    iconBadgeBorder: "rgba(15, 23, 42, 0.10)",
    ...overrides,
  };
}

/**
 * 표준 11개 섹션 서사 역할(T1-153 요청 사양) — 각 역할이 어느
 * `ImageCategory`로 이미지 composition을 만드는지 매핑한다. `PRODUCT_INFO`·
 * `CAUTION`은 이미지가 아니라 검증된 사실 패널(`product-story-facts-panel.ts`)
 * 로만 표시되므로 category가 없다(null) — 이 두 role은 이미지 생성 자체를
 * 시도하지 않는다(정보를 이미지 글자로 만들지 않는다는 기존 원칙과 동일).
 * `LIFESTYLE`·`HOW_TO`는 이 파이프라인의 기존 6개 `ImageCategory` 안에서
 * `USAGE_SCENE`을 함께 쓴다 — narrativeRole이 실제 목적을 구분하고,
 * `sectionId`가 asset 단위로 서로 다른 자리임을 표시한다.
 */
export const SECTION_NARRATIVE_ROLES = [
  "HERO",
  "PROBLEM_CONTEXT",
  "FEATURE",
  "USAGE",
  "LIFESTYLE",
  "DETAIL",
  "COMPONENTS",
  "HOW_TO",
  "PRODUCT_INFO",
  "CAUTION",
  "CLOSING",
] as const;

export type SectionNarrativeRole = (typeof SECTION_NARRATIVE_ROLES)[number];

export const NARRATIVE_ROLE_CATEGORY: Record<SectionNarrativeRole, ImageCategory | null> = {
  HERO: "HERO",
  PROBLEM_CONTEXT: "OTHER",
  FEATURE: "FEATURE_HIGHLIGHT",
  USAGE: "USAGE_SCENE",
  LIFESTYLE: "USAGE_SCENE",
  DETAIL: "DETAIL",
  COMPONENTS: "COMPONENTS",
  HOW_TO: "USAGE_SCENE",
  PRODUCT_INFO: null,
  CAUTION: null,
  CLOSING: "OTHER",
};

/**
 * Master Art Direction Contract를 만든다. LLM 호출 없음 — 순수 함수,
 * 결정적(입력이 없으므로 항상 같은 값). 지금은 제품마다 달라지는 입력이
 * 없어 canonical benchmark(프리미엄 호스 세트 시안) 기준 값 하나만
 * 반환하지만, 시그니처를 함수로 둔 이유는 이후 제품군별 마스터 계약이
 * 필요해져도 호출부(image-gen.service.ts)를 바꾸지 않기 위함이다.
 */
export function buildMasterArtDirectionContract(): MasterArtDirectionContract {
  return {
    contractId: `master-art-direction:${MASTER_ART_DIRECTION_VERSION}`,
    palette: CANONICAL_PALETTE,
    typographyRoles:
      "굵은 한국어 Display 헤드라인(섹션당 하나) + 짧은 영문 kicker + 본문/사양은 절제된 Body 서체 — 여러 폰트를 무분별하게 섞지 않는다",
    iconLanguage:
      "선 굵기와 스타일이 통일된 단색 라인 아이콘만 쓴다 — 섹션마다 다른 아이콘 스타일(면 채움/그라디언트 등)을 섞지 않는다",
    spacingRhythm:
      "섹션 사이 여백은 동일한 배수(예: 80px/120px)로 반복해 페이지 전체가 같은 리듬으로 읽히게 한다",
    gridSystem: "12컬럼 기준 그리드 — 좌우 정렬선이 섹션마다 흔들리지 않는다",
    imageTreatment:
      "모든 composition은 하나의 완성된 이미지로 생성한다 — 작은 이미지를 여러 장 이어붙인 콜라주로 만들지 않는다",
    lighting: "스튜디오 소프트박스~자연광 사이의 절제된 밝은 톤을 공유한다 — 섹션마다 조명 무드가 급변하지 않는다",
    cameraLanguage:
      "제품이 화면의 시각적 주인공이 되는 구도를 공유한다 — 배경이나 장식이 제품보다 크거나 시선을 더 끌지 않는다",
    borderRadiusShadow:
      "카드·이미지 프레임의 모서리 반경과 그림자 강도를 페이지 전체에서 동일하게 유지한다",
    backgroundTreatment: "화이트~소프트 뉴트럴 배경을 기본으로 하고, lifestyle/사용 장면만 실제 공간 배경을 쓴다",
    ctaLanguage: "이 엔진은 CTA 버튼/가격을 다루지 않는다 — 이미지 안에도 CTA 문구·버튼을 그리지 않는다",
    pageChrome:
      "상세페이지 HTML 컨테이너는 밝은 warm/cool off-white·very light blue-gray radial gradient " +
      "배경 위에 흰색 카드·패널을 얹는 premium editorial commerce 톤이다(제품 사진 자체의 스튜디오 " +
      "배경과는 별개 레이어) — navy는 타이포그래피·강조·closing 같은 제한된 패널에만 쓰고 페이지 " +
      "전체를 어둡게 만들지 않는다. 실제 값은 `buildStoryVisualTokens()`가 정의한다(T1-163)",
  };
}

/** 계약 정의가 바뀌면 버전을 올린다 — artDirectionContractId로 "어느 버전의 계약으로 만들어졌는가"를 구분한다 */
const ART_DIRECTION_CONTRACT_VERSION = "v1";

/** 승인된 프리미엄 호스 세트 시안 기준 — 모든 카테고리가 공유하는 팔레트 언어 */
const CANONICAL_PALETTE =
  "화이트~소프트 뉴트럴(#f8fafc~#ffffff) 베이스 배경 + teal(#0f766e)·blue(#0369a1) 계열의 " +
  "세련된 포인트 액센트, 진한 뉴트럴(#0f172a) 톤의 타이포그래피와 어울리는 절제된 톤";

const NO_TEXT_GUARDRAIL =
  "이미지 안에 제품명·모델명·사양 수치·원산지·주의사항 등 어떤 글자·숫자·로고·문자도 그리지 않는다 — " +
  "정확한 정보는 이 이미지 위에 HTML 텍스트로 별도 오버레이된다. 이미지는 장면·조명·배경·구도·연출에만 집중한다.";

const NO_INVENTION_GUARDRAIL =
  "사진에 없는 제품 형태·색상·재질·구성품·연결부를 새로 만들거나 바꾸지 않는다. " +
  "제공된 실제 제품 참조 사진에 있는 것만 그대로 표현한다 — 확인되지 않은 구성품·부속을 추가하지 않는다.";

interface ContractOptions {
  /** 이 카테고리에 대한 목적별(T1-99) 또는 범용(T1-92) 사용자 요구사항 — 표현/연출에만 반영 */
  userRequirement?: string | null;
  /** 이 이미지가 실제로 배정될 Story Section의 목적(있으면) — 계약의 purpose를 더 구체화 */
  storySectionPurpose?: string | null;
  /** 11개 표준 서사 역할(T1-153) — 지정하지 않으면 category로부터 가장 흔한 역할을 추정한다 */
  narrativeRole?: SectionNarrativeRole;
  /** 이 composition의 asset 자리 식별자(T1-153) — 지정하지 않으면 category 기준 기본값을 쓴다 */
  sectionId?: string;
  /** 이 composition을 만들 때 실제로 참조로 전달될 이미지 id(T1-153) — 호출자가 reference hierarchy 계산 후 채운다 */
  requiredReferenceIds?: string[];
  /** Story Planner가 만든 Master Creative Brief(T1-153) — 있으면 coreMessage/visualConcept을 이 섹션의 purpose에 이어 붙여, 개별 섹션이 페이지 전체 서사에서 벗어나지 않게 한다 */
  masterCreativeBrief?: { coreMessage: string; visualConcept: string } | null;
  /** 이 호출에 쓸 Master Art Direction Contract(T1-153) — 지정하지 않으면 기본 canonical 계약을 새로 만든다(결정적이라 항상 같은 값) */
  masterContract?: MasterArtDirectionContract;
}

interface CategoryArtDirectionBase {
  purpose: string;
  canvasRatio: string;
  focalPoint: string;
  productPlacement: string;
  cameraLighting: string;
  lensFeeling: string;
  crop: string;
  background: string;
  typographyRole: string;
  iconRole: string;
  whitespace: string;
  textSafeArea: string;
  compositionGeometry: string;
  visualHierarchy: string;
  copyRole: string;
  cta: string;
  referenceHierarchyGuidance: string;
}

/**
 * 카테고리별 기본 Art Direction — 승인된 프리미엄 호스 세트 시안의 섹션
 * 구성(HERO → 기능 → 사용 장면/lifestyle → 제품 디테일 → 구성품 → 마무리)을
 * `ImageCategory` 6종에 그대로 매핑한다. `OTHER`는 이 파이프라인에서
 * "closing/브랜드 무드" 역할을 맡는다 — 전용 카테고리가 따로 없는 마무리
 * 컷을 여기로 보낸다(요청 사양 "최소 HERO/feature/lifestyle/detail/closing
 * 5개 이상"을 6개 카테고리로 전부 만족한다).
 */
const CATEGORY_ART_DIRECTION: Record<ImageCategory, CategoryArtDirectionBase> = {
  HERO: {
    purpose:
      "상세페이지 최상단 — 실제 제품을 프리미엄 브랜드 광고처럼 보여주는 완성형 Hero composition",
    canvasRatio: "4:5 세로형 또는 1:1 — 오른쪽에 제품이 크게 자리 잡는 구도",
    focalPoint: "프레임 오른쪽 55~65% 영역에 제품을 크고 선명하게 배치",
    productPlacement:
      "제품을 화면 중앙~우측에 실제 크기감 있게, 살짝 대각선 각도로 입체감 있게 배치한다",
    cameraLighting: "스튜디오 소프트박스 조명, 부드러운 그림자, 고해상도 제품 사진 톤",
    lensFeeling: "표준~약망원(50~85mm 상당) — 왜곡 없이 제품 비율을 그대로 보여주는 광고 사진 렌즈감",
    crop: "제품 전체(끝단까지)가 프레임 안에 잘리지 않고 다 들어오도록 자른다",
    background: "화이트~소프트 뉴트럴 그라디언트, 잡동사니 없는 깨끗한 배경",
    typographyRole:
      "왼쪽 35~45% 영역은 굵은 한국어 Display 헤드라인 + 작은 영문 kicker가 얹힐 여백으로 비워둔다",
    iconRole: "이미지 안에는 기능 아이콘을 그리지 않는다 — 아이콘은 HTML에서 별도로 렌더링된다",
    whitespace: "왼쪽 35~45% 여백 확보 — 텍스트 오버레이가 들어갈 자리를 침범하지 않는다",
    textSafeArea: "왼쪽 0~40% 폭 전체 — 이 영역에는 제품·소품·그림자가 침범하지 않는다",
    compositionGeometry: "좌측 텍스트 컬럼 : 우측 제품 컬럼 = 대략 4:6 비대칭 분할, 제품은 대각선 배치로 입체감",
    visualHierarchy: "1순위: 제품 본체. 2순위: 배경의 은은한 그라디언트. 그 외 소품·장식은 두지 않는다",
    copyRole: "이 이미지는 카피를 담지 않는다",
    cta: "N/A — 이미지 자체에 CTA 버튼·문구를 그리지 않는다",
    referenceHierarchyGuidance:
      "제품 본체가 가장 잘 보이는 실제 제품 참조 사진을 최우선으로 따른다",
  },
  FEATURE_HIGHLIGHT: {
    purpose: "핵심 기능/차별점 하나를 시각적으로 강조하는 composition",
    canvasRatio: "1:1 또는 4:3 — 기능이 일어나는 부위가 화면 중앙을 채우는 구도",
    focalPoint: "그 기능과 직접 관련된 제품 부위(연결부·손잡이·트리거 등)를 화면 중앙에 크게",
    productPlacement: "제품 전체가 아니라 그 기능을 보여주는 부위를 중심으로 배치해도 된다",
    cameraLighting: "기능이 작동하는 순간처럼 보이는 방향성 있는 조명, 선명한 포커스",
    lensFeeling: "매크로에 가까운 근접 렌즈감 — 기능 부위의 형태·질감이 선명하게 드러난다",
    crop: "기능 부위를 화면 중앙에 여유 있게 두고 주변 배경은 최소한만 남긴다",
    background: "화이트~소프트 뉴트럴 배경 — 기능 자체에서 시선이 흩어지지 않게 단순하게 유지",
    typographyRole: "상단 또는 하단 10~20% 영역을 짧은 헤드라인 오버레이용 여백으로 남긴다",
    iconRole: "이미지 안에는 아이콘을 그리지 않는다",
    whitespace: "헤드라인이 얹힐 한쪽 여백을 확보한다",
    textSafeArea: "상단 또는 하단 15% 띠 영역 — 기능 부위와 겹치지 않게 비운다",
    compositionGeometry: "중앙 집중형 — 기능 부위를 화면 정중앙 60% 안에 배치",
    visualHierarchy: "1순위: 기능이 실제로 일어나는 부위. 2순위: 그 부위를 감싸는 제품 본체 일부",
    copyRole: "이 이미지는 카피를 담지 않는다",
    cta: "N/A",
    referenceHierarchyGuidance: "그 기능과 관련된 부위가 실제로 보이는 참조 사진을 우선한다",
  },
  USAGE_SCENE: {
    purpose: "실제 사용 장면/lifestyle — 제품이 쓰이는 상황을 크게 보여주는 composition",
    canvasRatio: "16:9 또는 4:3 — 공간과 제품이 함께 보이는 넓은 구도",
    focalPoint: "화면 중앙에 제품과 사용 동작이 함께 크게 보이도록",
    productPlacement: "제품이 실제 크기감으로 사용되는 순간을 중앙에 크게 배치한다",
    cameraLighting: "자연광에 가까운 밝고 사실적인 조명, 생활감 있는 톤",
    lensFeeling: "광각에 가까운 생활 스냅 렌즈감 — 공간과 동작이 함께 자연스럽게 담긴다",
    crop: "인물은 필요한 만큼만(얼굴 클로즈업이 목적이 아니면 상반신 이하도 허용), 제품과 동작은 잘리지 않게",
    background: "제품이 실제로 쓰이는 자연스러운 공간(베란다·실내 등) — 어수선하지 않게 정돈",
    typographyRole: "텍스트 오버레이 없이도 성립하는 장면 — 필요하면 하단 여백만 소량 남긴다",
    iconRole: "이미지 안에는 아이콘을 그리지 않는다",
    whitespace: "제품과 동작을 가리지 않는 선에서 최소한의 여백만",
    textSafeArea: "하단 10% 띠 영역만(필요할 때) — 그 외 프레임은 장면으로 가득 채운다",
    compositionGeometry: "삼분할 구도 — 제품/동작을 교차점 부근에 배치, 공간감을 위해 배경을 넓게 둔다",
    visualHierarchy: "1순위: 제품이 실제로 쓰이는 동작. 2순위: 제품 형태. 3순위: 공간/배경",
    copyRole: "이 이미지는 카피를 담지 않는다",
    cta: "N/A",
    referenceHierarchyGuidance: "제품 본체·호스 등 형태가 뚜렷이 보이는 참조 사진을 우선한다",
  },
  DETAIL: {
    purpose: "제품 디테일 — 본체·노즐·연결부·마감의 클로즈업 composition",
    canvasRatio: "1:1 — 표면 질감·마감이 화면을 가득 채우는 클로즈업",
    focalPoint: "본체/노즐/연결부/마감 처리가 화면 중앙에 최대한 크게",
    productPlacement: "제품 디테일 부위를 화면의 70% 이상 채우도록 근접 배치한다",
    cameraLighting: "마감·질감이 선명하게 드러나는 측광 또는 상단광, 얕은 피사계 심도",
    lensFeeling: "매크로 렌즈감 — 질감·마감·연결부 틈새까지 선명하게",
    crop: "디테일 부위를 프레임 가장자리까지 크게 채우고, 필요하면 일부러 여백 없이 꽉 차게 자른다",
    background: "화이트~소프트 뉴트럴 배경, 디테일에서 시선이 흩어지지 않게",
    typographyRole: "텍스트 오버레이가 필요 없는 순수 클로즈업 — 여백을 억지로 만들지 않는다",
    iconRole: "이미지 안에는 아이콘을 그리지 않는다",
    whitespace: "여백보다 디테일의 크기를 우선한다",
    textSafeArea: "없음 — 이 이미지 위에는 텍스트 오버레이를 얹지 않는다",
    compositionGeometry: "클로즈업 중앙 배치 — 여백을 최소화하고 디테일 자체가 프레임을 채운다",
    visualHierarchy: "1순위: 표면 질감·마감·연결부. 그 외 요소는 프레임에 담기지 않는다",
    copyRole: "이 이미지는 카피를 담지 않는다",
    cta: "N/A",
    referenceHierarchyGuidance:
      "본체/노즐/스텐 주름 호스 등 실제 디테일이 뚜렷이 보이는 참조 사진을 최우선으로 따른다",
  },
  COMPONENTS: {
    purpose: "실제로 확인된 구성품만 정갈하게 펼쳐 보여주는 composition",
    canvasRatio: "4:3 또는 1:1 — 구성품이 한눈에 들어오는 플랫레이 구도",
    focalPoint: "각 구성품이 겹치지 않고 화면에 고르게 배치되도록",
    productPlacement: "제공된 실제 구성품 참조 사진에 있는 개수·형태 그대로만 배치한다 — 개수를 늘리거나 새 구성품을 추가하지 않는다",
    cameraLighting: "탑뷰 또는 45도 플랫레이 조명, 그림자 최소화",
    lensFeeling: "탑뷰 표준 렌즈감 — 원근 왜곡 없이 구성품 크기 비율이 그대로 비교되게",
    crop: "구성품 전체 세트가 여백과 함께 한 프레임에 다 들어오도록 넉넉히 자른다",
    background: "화이트~소프트 뉴트럴 단색 배경",
    typographyRole: "각 구성품 아래에 라벨이 얹힐 여백을 남긴다 — 라벨 텍스트 자체는 그리지 않는다",
    iconRole: "이미지 안에는 아이콘을 그리지 않는다",
    whitespace: "구성품 사이·아래에 라벨용 여백을 남긴다",
    textSafeArea: "각 구성품 바로 아래 10~15% 띠 — 라벨 텍스트가 오버레이될 자리",
    compositionGeometry: "그리드 플랫레이 — 구성품을 균등한 간격의 그리드로 배열, 겹침 없음",
    visualHierarchy: "모든 구성품이 동등한 시각적 비중 — 특정 구성품만 과장해서 크게 그리지 않는다",
    copyRole: "이 이미지는 카피를 담지 않는다",
    cta: "N/A",
    referenceHierarchyGuidance:
      "실제로 검증된 구성품 참조 사진에 있는 항목만 그대로 표현한다 — 목록에 없는 구성품을 상상해 추가하지 않는다",
  },
  OTHER: {
    purpose: "마무리(closing)/브랜드 무드 — 제품의 가치를 정서적으로 정리하는 composition",
    canvasRatio: "16:9 또는 1:1 — 여백이 넉넉한 차분한 구도",
    focalPoint: "제품을 화면 한쪽에 절제되게 배치하고 나머지는 여백으로",
    productPlacement: "제품을 작지 않게, 그러나 화면을 압도하지 않게 배치한다",
    cameraLighting: "부드럽고 차분한 톤, 과장 없는 자연스러운 조명",
    lensFeeling: "표준 렌즈감 — 차분하고 절제된 광고 마무리 컷의 톤",
    crop: "제품을 한쪽에 절제되게 두고 나머지 프레임은 여백으로 남긴다",
    background: "화이트~소프트 뉴트럴 배경, 절제된 분위기",
    typographyRole: "화면 한쪽에 마무리 문구가 얹힐 넉넉한 여백을 남긴다",
    iconRole: "이미지 안에는 아이콘을 그리지 않는다",
    whitespace: "전체적으로 여백을 넉넉히 남겨 차분한 마무리 톤을 만든다",
    textSafeArea: "제품 반대편 40~50% 영역 — 마무리 문구가 얹힐 자리",
    compositionGeometry: "비대칭 여백형 — 제품은 한쪽 1/3, 여백은 나머지 2/3",
    visualHierarchy: "1순위: 제품(작지만 명확하게). 2순위: 차분한 배경 톤 — 그 외 장식 없음",
    copyRole: "이 이미지는 카피를 담지 않는다",
    cta: "N/A",
    referenceHierarchyGuidance: "제품 본체가 뚜렷이 보이는 참조 사진을 우선한다",
  },
};

/**
 * 카테고리에 대한 Art Direction Contract를 만든다. LLM 호출 없음 — 순수
 * 함수, 결정적(같은 category+options → 같은 contractId·같은 내용).
 */
export function buildCompositionContract(
  category: ImageCategory,
  options: ContractOptions = {},
): SectionCompositionContract {
  const base = CATEGORY_ART_DIRECTION[category];
  const masterContract = options.masterContract ?? buildMasterArtDirectionContract();
  const narrativeRole =
    options.narrativeRole ??
    (Object.entries(NARRATIVE_ROLE_CATEGORY).find(([, cat]) => cat === category)?.[0] as
      | SectionNarrativeRole
      | undefined) ??
    "HERO";
  let purpose = options.storySectionPurpose?.trim()
    ? `${base.purpose} (이 상세페이지에서는 "${options.storySectionPurpose.trim()}" 역할의 섹션에 쓰인다)`
    : base.purpose;
  if (options.masterCreativeBrief?.coreMessage?.trim() || options.masterCreativeBrief?.visualConcept?.trim()) {
    const brief = options.masterCreativeBrief;
    purpose = `${purpose} 페이지 전체의 핵심 메시지("${brief.coreMessage?.trim() || "-"}")와 시각 컨셉("${
      brief.visualConcept?.trim() || "-"
    }")에서 벗어나지 않는다.`;
  }
  return {
    contractId: `art-direction:${category.toLowerCase()}:${ART_DIRECTION_CONTRACT_VERSION}`,
    category,
    masterContractId: masterContract.contractId,
    sectionId: options.sectionId?.trim() || `section:${narrativeRole.toLowerCase()}`,
    narrativeRole,
    purpose,
    canvasRatio: base.canvasRatio,
    focalPoint: base.focalPoint,
    productPlacement: base.productPlacement,
    cameraLighting: base.cameraLighting,
    lensFeeling: base.lensFeeling,
    crop: base.crop,
    background: base.background,
    palette: masterContract.palette,
    typographyRole: base.typographyRole,
    iconRole: base.iconRole,
    whitespace: base.whitespace,
    textSafeArea: base.textSafeArea,
    compositionGeometry: base.compositionGeometry,
    visualHierarchy: base.visualHierarchy,
    imageCount: 1,
    copyRole: base.copyRole,
    cta: base.cta,
    referenceHierarchyGuidance: base.referenceHierarchyGuidance,
    requiredReferenceIds: options.requiredReferenceIds ?? [],
    sectionUserRequirements: options.userRequirement?.trim() || null,
    negativeGuardrails: `${NO_INVENTION_GUARDRAIL} ${NO_TEXT_GUARDRAIL}`,
  };
}

/**
 * Art Direction Contract를 Gemini에 실제로 보낼 instruction 문장으로
 * 조립한다. `buildImageGenerationPrompt`(product-package.ts)의
 * `instruction` 자리에 그대로 들어간다 — 제품 동일성 규칙·글자 금지
 * 규칙·사람 모델 규칙은 그 함수가 이미 앞에 붙이므로 여기서 반복하지
 * 않는다(중복 지시는 노이즈만 늘린다는 `product-package.ts`의 원칙과
 * 동일).
 */
export function buildCompositionPrompt(contract: SectionCompositionContract, userRequirement?: string | null): string {
  const lines = [
    `[Art Direction Contract — ${contract.category} / ${contract.narrativeRole}]`,
    `목적: ${contract.purpose}`,
    `캔버스 비율: ${contract.canvasRatio}`,
    `시각적 초점: ${contract.focalPoint}`,
    `제품 배치: ${contract.productPlacement}`,
    `구도 규칙: ${contract.compositionGeometry}`,
    `시각적 우선순위: ${contract.visualHierarchy}`,
    `카메라/조명: ${contract.cameraLighting}`,
    `렌즈 인상: ${contract.lensFeeling}`,
    `프레이밍/크롭: ${contract.crop}`,
    `배경: ${contract.background}`,
    `팔레트: ${contract.palette}`,
    `타이포그래피 자리: ${contract.typographyRole}`,
    `텍스트 안전 영역(이 영역은 제품·소품으로 침범하지 않는다): ${contract.textSafeArea}`,
    `아이콘 처리: ${contract.iconRole}`,
    `여백: ${contract.whitespace}`,
    `참조 우선순위: ${contract.referenceHierarchyGuidance}`,
    contract.negativeGuardrails,
  ];
  if (userRequirement?.trim()) {
    lines.push(`이 섹션에 대한 참고 요청(제품 사실과 충돌하면 무시): ${userRequirement.trim()}`);
  }
  return lines.join(" ");
}
