import type { StoryDesignPlan } from "./product-story-design";
import type { StoryIconId } from "./product-page-icons";
import type { ProductStory } from "./product-story";

/**
 * Product Story — 생성형 타이포그래피/아이콘/그래픽 자산 계약. (T1-142)
 *
 * `product-story-auxiliary-visual.ts`(T1-112/T1-123)는 텍스트 전용 섹션의
 * **배경 장식**을 Gemini로 만든다. 이 파일은 역할이 다른 두 번째 종류의
 * 생성형 자산을 계획한다 — 상세페이지 전체가 공유하는 **아이콘 세트**와
 * **Hero 레터링/모티프 그래픽**. 요청 사양(T1-142)이 금지한 "기본
 * Unicode/emoji/동그라미 불릿"·"단순 h1/p 타이핑"을 실제 생성형 자산으로
 * 대체하기 위한 계획 단계다.
 *
 * ## 이 파일이 하지 않는 것 (의도적, `product-story-auxiliary-visual.ts`와 같은 원칙)
 *
 * - **실제 Gemini API를 호출하지 않는다.** 순수 함수 — 프롬프트 문자열과
 *   "무엇을 요청할 것인가"라는 계획만 만든다. 실제 호출은
 *   `ImageGenService.generateDesignAsset()`(신규, T1-142)이 계획을 그대로
 *   받아 수행한다.
 * - **정확한 상품 정보 텍스트를 이미지 글자로 요청하지 않는다.** 제품명·
 *   사양·원산지·재질·주의사항 같은 사실은 HTML(`product-story-html.ts`)로만
 *   렌더링한다(요청 사양 1) — 이 파일이 만드는 프롬프트는 전부
 *   "글자·숫자·로고·문자를 그리지 말라"는 금지 지시를 포함한다.
 * - **제품 실물을 새로 그리지 않는다.** 아이콘·모티프는 섹션의 구조적
 *   의미(체크·사양·구성품·주의·순서)를 상징하는 추상 그래픽이지, 제품
 *   사진을 대체하는 것이 아니다(요청 사양 5) — `product-page-icons.ts`의
 *   기존 아이콘 의미 체계를 그대로 유지하고, 새 의미를 지어내지 않는다.
 *
 * ## 선정 규칙
 *
 * - 아이콘: 이번 Story의 Design Plan이 실제로 배정한 아이콘(`icon !==
 *   "none"`)만, 중복 없이 계획한다 — 쓰이지 않을 아이콘까지 만들어 비용을
 *   낭비하지 않는다. `product-page-icons.ts`의 6종이 자연스러운 상한이다.
 * - Hero 모티프: 섹션이 하나라도 있으면 항상 1개만 계획한다(Hero 헤드라인
 *   배경 + 요약 밴드 divider에 재사용, `product-story-html.ts`) — "재사용
 *   가능한 디자인 토큰으로 연결"(요청 사양 2)이라는 요구를 여러 장 생성이
 *   아니라 하나의 자산을 여러 자리에 재사용하는 방식으로 만족한다.
 */

export type GenerativeVisualKind = "ICON" | "HERO_MOTIF";

export interface GenerativeIconSpec {
  kind: "ICON";
  /** 아이콘 자체를 자산 id로 쓴다 — 같은 아이콘은 한 Story당 한 번만 생성 */
  id: StoryIconId;
  reason: string;
  promptText: string;
}

export interface GenerativeHeroMotifSpec {
  kind: "HERO_MOTIF";
  id: "hero-motif";
  reason: string;
  promptText: string;
}

export type GenerativeVisualSpec = GenerativeIconSpec | GenerativeHeroMotifSpec;

/** 생성 결과 — 실제 바이트는 호출자(`ImageGenService`)가 채운다 */
export interface GenerativeVisualAsset {
  kind: GenerativeVisualKind;
  id: string;
  source: "gemini-generative-design";
  mimeType: string;
  base64: string;
}

/** 한 상세페이지에서 계획할 수 있는 최대 아이콘 수 — `product-page-icons.ts`의 실제 아이콘 종류 수와 같다 */
const MAX_GENERATIVE_ICONS = 7;

const ICON_MEANING: Record<Exclude<StoryIconId, "none">, string> = {
  check: "핵심 장점이 충족되었음을 나타내는 체크마크",
  spec: "제품 사양·규격 목록을 나타내는 스펙 아이콘",
  box: "구성품·패키지 구성을 나타내는 박스 아이콘",
  info: "참고 안내 정보를 나타내는 정보 아이콘",
  warning: "주의사항·경고를 나타내는 경고 아이콘",
  gallery: "여러 장의 사진 갤러리를 나타내는 아이콘",
  steps: "사용 순서·단계를 나타내는 단계 아이콘",
  // "arrow"는 레이아웃 의미를 나타내는 아이콘이 아니라 premium feature
  // row의 고정 화살표 affordance라(product-story-html.ts의
  // heroFeatureRow, T1-162) `LAYOUT_VISUAL_TOKENS`에 배정되지 않는다 —
  // 즉 이 맵을 통해 생성형 아이콘으로 대체되는 일이 없다. 그래도
  // `Record<Exclude<StoryIconId,"none">, string>`는 모든 키를 요구하므로
  // (놓친 아이콘이 조용히 안 보이는 것을 막는 안전장치) 설명만 채운다.
  arrow: "카드/행에 더 볼 내용이 있음을 나타내는 화살표 affordance(생성형 대체 대상 아님)",
};

const ICON_NEGATIVE_GUARDRAILS =
  "글자·숫자·로고·문자·상표를 그리지 마세요. 실제 제품(호스·용기·포장 등 구체적인 사물 형태)을 그리지 마세요 — " +
  "이 이미지는 제품 사진이 아니라 의미를 상징하는 추상 아이콘 그래픽입니다. 배경은 단색 또는 투명하게, " +
  "아이콘 하나만 중앙에 크게 배치하세요.";

/**
 * 이번 Story가 실제로 쓰는 아이콘만 중복 없이 골라 생성 계획을 만든다.
 * LLM 호출 없음 — 순수 함수. `MAX_GENERATIVE_ICONS`를 넘으면 이후 등장
 * 순서의 아이콘은 계획에서 제외한다(원칙상 발생하지 않는다 — 아이콘
 * 종류 자체가 6개뿐이므로).
 */
export function planGenerativeIcons(designPlan: StoryDesignPlan): GenerativeIconSpec[] {
  const seen = new Set<StoryIconId>();
  const specs: GenerativeIconSpec[] = [];
  for (const section of designPlan.sections) {
    if (section.icon === "none" || seen.has(section.icon)) continue;
    if (specs.length >= MAX_GENERATIVE_ICONS) break;
    seen.add(section.icon);
    specs.push({
      kind: "ICON",
      id: section.icon,
      reason: `"${section.layout}" 레이아웃이 사용하는 아이콘 — ${ICON_MEANING[section.icon]}`,
      promptText: buildGenerativeIconPrompt(section.icon, section.accentColor),
    });
  }
  return specs;
}

export function buildGenerativeIconPrompt(icon: Exclude<StoryIconId, "none">, accentColor: string): string {
  return [
    "[상세페이지 아이콘 생성 — 제품 사진 아님]",
    `${ICON_MEANING[icon]}을(를) 미니멀하고 세련된 생성형 아이콘 일러스트로 만들어주세요.`,
    `주 색상은 ${accentColor} 계열의 부드러운 그라디언트 또는 단색 라인으로, 현대적인 쇼핑몰 상세페이지에 어울리는 통일된 일러스트 스타일로 그려주세요.`,
    ICON_NEGATIVE_GUARDRAILS,
  ].join(" ");
}

const MOTIF_NEGATIVE_GUARDRAILS =
  "글자·숫자·로고·문자·상표·워터마크를 그리지 마세요. 사람이나 실제 제품 실물을 그리지 마세요 — " +
  "이 이미지는 제품 사진이 아니라 헤드라인 뒤에 은은하게 깔리는 추상 타이포그래피 모티프(브러시 스트로크·잉크 " +
  "스월·기하학적 액센트 셰이프 등)입니다.";

/**
 * Hero 헤드라인용 레터링/모티프 그래픽 1개를 계획한다. 실제 글자를 그리는
 * 대신(요청 사양 1 — 정확한 상품명은 HTML로 렌더링) "타이포그래피적
 * 느낌"을 주는 추상 액센트 그래픽만 요청한다 — 브러시 스트로크·언더라인
 * 스월·기하학적 강조 셰이프 등. 이 자산은 Hero 배경과 Story 요약 밴드
 * 구분선에 재사용된다(`product-story-html.ts`).
 */
export function planGenerativeHeroMotif(story: ProductStory): GenerativeHeroMotifSpec | null {
  if (story.sections.length === 0) return null;
  return {
    kind: "HERO_MOTIF",
    id: "hero-motif",
    reason: "Hero 헤드라인·Story 요약 구분선에 재사용할 브랜드 타이포그래피 모티프",
    promptText: buildGenerativeHeroMotifPrompt(story.narrativeSummary),
  };
}

export function buildGenerativeHeroMotifPrompt(narrativeSummary: string): string {
  return [
    "[상세페이지 헤드라인 타이포그래피 모티프 생성 — 제품 사진 아님, 글자 없음]",
    "쇼핑몰 상세페이지 Hero 섹션의 헤드라인 뒤에 은은하게 깔릴 추상적인 타이포그래피 액센트 그래픽을 만들어주세요.",
    `이 상세페이지가 전달하려는 전체 분위기: "${narrativeSummary}"`,
    "브러시 스트로크, 잉크 스월, 다이내믹한 곡선, 기하학적 강조 셰이프 중 하나의 스타일로, 밝은 오프화이트/" +
      "블루그레이 배경 위에서도(T1-163 — 프리미엄 다크 네이비에서 밝은 팔레트로 전환) 은은하게 보이도록 " +
      "부드러운 파스텔 또는 잉크워시 톤으로 그려주세요.",
    MOTIF_NEGATIVE_GUARDRAILS,
  ].join(" ");
}
