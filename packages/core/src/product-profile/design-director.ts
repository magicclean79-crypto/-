import type { ProductProfile } from "@acos/shared";
import type { LlmMessageDto } from "@acos/shared";
import {
  ACCENT_TYPEFACES,
  ACCENT_USAGES,
  CARD_RADII,
  CARD_VARIANTS,
  COLORWAY_IDS,
  type CompositionFamilyId,
  FAMILY_COLORWAYS,
  GRAPHIC_MOTIF_FAMILIES,
  GRAPHIC_MOTIF_INTENSITIES,
  HEADING_WEIGHTS,
  ICON_CORNER_STYLES,
  ICON_FAMILIES,
  ICON_FAMILY_DESCRIPTIONS,
  ICON_OPTICAL_SIZES,
  ICON_STROKE_WIDTHS,
  IMAGE_BACKGROUND_TREATMENTS,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  NUMERIC_STYLES,
  SPACING_DENSITIES,
  VISUAL_STYLE_FAMILIES,
  VISUAL_STYLE_FAMILY_DESCRIPTIONS,
} from "./design-profile";

/**
 * Design Director — Product Profile → DESIGN_PROFILE 프롬프트. (T1-176)
 *
 * ## 입력 원칙
 *
 * 이 함수는 **검증된 `ProductProfile`(GPT가 STEP 4에서 실제로 답한 값)만**
 * 입력받는다 — OCR 원문(`ProductProfile.ocrText` at DB 레벨)이나 포장지
 * 사진 자체는 이 함수 시그니처에 아예 나타나지 않는다(요청 사양: "OCR raw
 * text나 포장지 이미지 자체를 DESIGN_PROFILE AI 입력으로 사용하지
 * 않는다"). 호출자(`apps/api/src/product-profile/product-profile.service.ts`)
 * 가 실수로 원문을 함께 넘기더라도 이 함수는 그 값을 받을 방법이 없다 —
 * 타입 시그니처 자체가 가드레일이다.
 *
 * ## 제품 이미지와의 분리
 *
 * 프롬프트 어디에도 이미지 바이트·이미지 생성 지시가 없다 — 순수 텍스트
 * 기반 스타일 결정이다. "제품 형태/구성/색상을 재구성/변형하라"는 지시를
 * 만들지 않으며, 오히려 명시적으로 금지 문구를 프롬프트에 포함한다.
 */
export interface DesignDirectorInput {
  productName: string;
  brand: string | null;
  material: string | null;
  features: string[];
  specifications: Record<string, string>;
  usage: string | null;
  advantages: string[];
  keywords: string[];
}

/** `ProductProfile`(검증된 값)에서 Design Director 입력만 골라낸다 — warnings 등 디자인과 무관한 필드는 제외한다 */
export function buildDesignDirectorInput(profile: ProductProfile): DesignDirectorInput {
  return {
    productName: profile.productName,
    brand: profile.brand,
    material: profile.material,
    features: profile.features,
    specifications: profile.specifications,
    usage: profile.usage,
    advantages: profile.advantages,
    keywords: profile.keywords,
  };
}

function describeVocabulary(): string {
  const familyLines = VISUAL_STYLE_FAMILIES.map(
    (family) =>
      `- "${family}": ${VISUAL_STYLE_FAMILY_DESCRIPTIONS[family]} (허용 colorway: ${FAMILY_COLORWAYS[family].join(", ")})`,
  ).join("\n");
  return [
    "아래 어휘 목록에 있는 값만 골라야 한다 — 목록에 없는 값·새로운 값을 지어내면 안 된다.",
    "",
    "visualStyle (5개 중 하나, 제품 소재/사용환경/브랜드 톤에 가장 맞는 것):",
    familyLines,
    "",
    `colorway: 위에서 고른 visualStyle에 허용된 목록(전체: ${COLORWAY_IDS.join(", ")}) 중 하나만.`,
    `typography.headingWeight: ${HEADING_WEIGHTS.join(", ")}`,
    `typography.letterSpacing: ${LETTER_SPACINGS.join(", ")}`,
    `typography.lineHeight: ${LINE_HEIGHTS.join(", ")}`,
    `typography.numericStyle: ${NUMERIC_STYLES.join(", ")}`,
    `typography.accentTypeface: ${ACCENT_TYPEFACES.join(", ")}`,
    "",
    "iconStyle.family (5개 중 하나, 이 상세페이지 전체 아이콘의 shape 언어를 정한다):",
    ICON_FAMILIES.map((family) => `- "${family}": ${ICON_FAMILY_DESCRIPTIONS[family]}`).join("\n"),
    `iconStyle.strokeWidth: ${ICON_STROKE_WIDTHS.join(", ")}`,
    `iconStyle.cornerStyle: ${ICON_CORNER_STYLES.join(", ")}`,
    `iconStyle.opticalSize: ${ICON_OPTICAL_SIZES.join(", ")}`,
    `cardStyle.variant: ${CARD_VARIANTS.join(", ")}`,
    `cardStyle.radius: ${CARD_RADII.join(", ")}`,
    `graphicMotif.family: ${GRAPHIC_MOTIF_FAMILIES.join(", ")}`,
    `graphicMotif.intensity: ${GRAPHIC_MOTIF_INTENSITIES.join(", ")}`,
    `spacingDensity: ${SPACING_DENSITIES.join(", ")}`,
    `imageTreatment.backgroundTreatment: ${IMAGE_BACKGROUND_TREATMENTS.join(", ")}`,
    `accentUsage: ${ACCENT_USAGES.join(", ")}`,
  ].join("\n");
}

const RESPONSE_SHAPE_EXAMPLE = `{
  "visualStyle": "industrial-premium",
  "colorway": "harbor-steel",
  "rationale": "왜 이 스타일을 골랐는지 한 문장(제품 소재/사용환경/브랜드 톤 근거)",
  "typography": {"headingWeight":"700","letterSpacing":"tight","lineHeight":"comfortable","numericStyle":"tabular","accentTypeface":"technical-grotesk"},
  "iconStyle": {"family":"technical-outline","strokeWidth":"regular","cornerStyle":"sharp","opticalSize":"standard"},
  "cardStyle": {"variant":"soft-shadow","radius":"soft"},
  "graphicMotif": {"family":"dot-grid","intensity":"subtle"},
  "spacingDensity": "standard",
  "imageTreatment": {"backgroundTreatment":"letterbox-neutral"},
  "accentUsage": "balanced",
  "avoid": ["이 제품에 어울리지 않는다고 판단해 피한 것(선택, 없으면 빈 배열)"]
}`;

/**
 * Design Director LLM 호출용 메시지. `LlmService.complete`에
 * `responseFormat: "json"`과 함께 그대로 넘긴다(Story Planner와 같은
 * 패턴, `product-profile.service.ts`의 `generateStory` 참고).
 */
export function buildDesignDirectorPrompt(input: DesignDirectorInput): LlmMessageDto[] {
  const specLines = Object.entries(input.specifications)
    .map(([key, value]) => `  - ${key}: ${value}`)
    .join("\n");

  const system = [
    "너는 이커머스 상세페이지의 Art Director다.",
    "너의 역할은 색상 hex·CSS·아이콘 SVG를 직접 만드는 것이 아니라, 아래 제품 정보를 근거로 " +
      "미리 정의된 디자인 어휘 중에서 이 제품에 가장 어울리는 조합을 고르는 것이다 — " +
      "렌더러가 네 선택을 실제 값으로 변환한다.",
    "이미지를 생성하거나 편집하는 작업이 아니다. 제품 사진 자체는 이 작업과 무관하며, " +
      "너는 제품 형태·구성품·색상을 지시하거나 바꿀 수 없다 — 그런 필드는 응답에 존재하지 않는다.",
    "premium/commerce-safe 톤을 유지한다 — 실험적이거나 가독성을 해치는 조합을 고르지 않는다.",
    "아래 제공된 필드 외의 정보(포장지 원문·사진)는 참고하지 않는다. 모르는 값은 추측하지 말고 " +
      "주어진 필드만으로 판단한다.",
    "반드시 JSON 객체 하나만 출력한다. 다른 텍스트를 덧붙이지 않는다.",
  ].join(" ");

  const user = [
    "다음은 검증된 제품 정보다 — 이 정보만 근거로 디자인 방향을 결정해라.",
    "",
    `제품명: ${input.productName}`,
    `브랜드: ${input.brand ?? "미확인"}`,
    `소재: ${input.material ?? "미확인"}`,
    `사용 목적/환경: ${input.usage ?? "미확인"}`,
    input.features.length > 0 ? `핵심 기능:\n${input.features.map((f) => `  - ${f}`).join("\n")}` : "핵심 기능: 미확인",
    input.advantages.length > 0 ? `장점:\n${input.advantages.map((a) => `  - ${a}`).join("\n")}` : "장점: 미확인",
    specLines ? `사양:\n${specLines}` : "사양: 미확인",
    input.keywords.length > 0 ? `키워드: ${input.keywords.join(", ")}` : "키워드: 미확인",
    "",
    describeVocabulary(),
    "",
    "아래 형태의 JSON 객체 하나만 출력해라(값은 예시이며 그대로 복사하지 말고 이 제품에 맞게 골라라):",
    RESPONSE_SHAPE_EXAMPLE,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Composition family(T1-183/T1-185, `design-profile.ts`의
 * `COMPOSITION_FAMILIES`, 최소 6개) — **LLM을 부르지 않는** 결정적
 * 규칙이다. 색·타이포·아이콘(`DesignDirectorChoice`)은 자연어 판단이
 * 필요해 LLM에 맡기지만, "이 제품이 사양 중심 카탈로그에 가까운지 사용
 * 장면 중심 브로셔에 가까운지"는 `ProductProfile`에 이미 있는 사실(사양
 * 개수·기능 개수·장점 개수·사용 설명 길이)만으로 셀 수 있는 정량 신호라,
 * LLM 호출을 추가하지 않고도(비용 없음, `docs/PROJECT_MEMORY.md` "API
 * 비용 최소화") 제품마다 다른 값을 낼 수 있다 — "하드코딩 금지, 제품
 * 특성 기반 결정 로직 필요"라는 요청 사양을 이 방식으로 충족한다.
 *
 * 규칙(정량 임계값, 특정 제품 ID에 대한 분기 없음, 위에서부터 먼저
 * 맞는 분기 하나만 선택 — T1-183의 기존 두 분기는 조건·순서 그대로
 * 유지해 회귀가 없다):
 * - 사양(`specifications`) 8개 이상 + 사용 설명(`usage`)이 40자 미만
 *   (또는 없음) → `technical-catalog`: 사용 장면보다 스펙표가 이 제품을
 *   설명하는 핵심 정보라는 뜻이다.
 * - 기능(`features`) 2개 이하 + 사양 2개 이하 + 장점(`advantages`) 1개
 *   이하 → `minimal-lifestyle`: 강조할 스펙/기능 자체가 적어 여백 중심
 *   레이아웃이 어울린다.
 * - 장점(`advantages`) 4개 이상이고 사양 개수보다 많음 → `bold-statement`:
 *   구체적 수치보다 마케팅 포인트가 이 제품을 설명하는 핵심이라, 중앙
 *   정렬 대형 헤드라인과 여유 있는 여백이 어울린다.
 * - 사양 4~7개(중간 밀도) + 사용 설명이 있고 60자 미만 → `compact-utility`:
 *   technical-catalog만큼 사양이 많지는 않지만 여전히 스펙 중심 실용
 *   제품이라, 여백을 줄인 좁은 텍스트 폭이 어울린다.
 * - 기능(`features`) 6개 이상 → `gallery-forward`: 강조할 특징이 많아
 *   갤러리 밀도(3열)로 실제 제품 사진을 더 많이 보여주는 편이 낫다.
 * - 그 외 전부(가장 흔한 케이스 — 기능·사양·사용 설명이 고르게 있는
 *   일반 생활용품) → `editorial-brochure`(기본값). 현재 benchmark
 *   제품(호스 분사기, 기능4·사양3·장점2·사용 설명 있음)은 위 어느
 *   분기에도 해당하지 않아 이 기본 분기로 떨어진다(T1-183과 동일한
 *   editorial-brochure 결과 유지, 회귀 없음 — 실측은
 *   `design-director.spec.ts` 참고).
 */
export function selectCompositionFamily(input: DesignDirectorInput): CompositionFamilyId {
  const specCount = Object.keys(input.specifications).length;
  const featureCount = input.features.length;
  const advantageCount = input.advantages.length;
  const usageLength = (input.usage ?? "").trim().length;

  if (specCount >= 8 && usageLength < 40) {
    return "technical-catalog";
  }
  if (featureCount <= 2 && specCount <= 2 && advantageCount <= 1) {
    return "minimal-lifestyle";
  }
  if (advantageCount >= 4 && advantageCount > specCount) {
    return "bold-statement";
  }
  if (specCount >= 4 && specCount <= 7 && usageLength > 0 && usageLength < 60) {
    return "compact-utility";
  }
  if (featureCount >= 6) {
    return "gallery-forward";
  }
  return "editorial-brochure";
}
