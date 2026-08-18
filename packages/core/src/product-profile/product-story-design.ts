import type { ProductStory, ProductStorySection } from "./product-story";
import type { StoryIconId } from "./product-page-icons";

/**
 * Product Story — Visual/Design Director. (T1-97, 2026-08-12)
 *
 * `product-story-html.ts`(T1-94)는 모든 섹션을 "사진(있으면) → 카피"라는
 * 하나의 고정 마크업으로 반복 렌더링했다 — 요청 사양이 명시적으로 금지한
 * "모든 섹션을 같은 템플릿으로 반복"하는 패턴이다. 이 파일은 그 사이에
 * 정식 단계를 하나 더 추가한다:
 *
 *   Story Section(목적·이미지 역할·근거·카피 길이) → Design Spec(레이아웃·
 *   타이포그래피·강조 색상)
 *
 * LLM 호출 없음 — 순수 함수. Story Planner/Copywriter가 이미 만든 필드
 * (`purpose`·`keyMessage`·`imageRole`·`productFacts`·`copy`)만으로 결정한다.
 * 새 AI 호출을 추가하지 않는 것은 비용을 최소화하기 위한 의도적 선택이다
 * (`docs/PROJECT_MEMORY.md` "API 비용 최소화").
 *
 * 레이아웃은 "실제로 그 섹션이 무엇을 하는가"에서 도출한다 — 무작위로
 * 순환시키지 않는다. comparison-like 레이아웃은 요청 사양이 "실제 비교
 * 데이터가 있을 때만" 쓰라고 명시했는데 이 파이프라인에는 비교 데이터
 * 소스 자체가 없으므로 절대 만들지 않는다.
 *
 * ## T1-112 확장 — 타이포그래피·아이콘·강조색
 *
 * T1-97까지는 이 파일이 레이아웃 변형(`layout`) 하나만 정했다 — 실제
 * 글꼴·아이콘·색상은 렌더러(`product-story-html.ts`)의 고정 CSS 한 벌이
 * 전부 처리해 "글꼴/아이콘을 적극 활용하지 못한다"는 지적을 받았다. 이
 * 확장은 같은 원칙(LLM 호출 없음, 결정적 순수 함수, 이미 있는 필드에서만
 * 도출)을 유지하면서 두 가지를 더 정한다:
 *
 * - `typography` — 섹션 전체가 공유하는 역할별 글꼴 스택(제목/본문/강조/
 *   숫자). 이 프로젝트에는 외부 웹폰트 서버가 없고(`apps/web/app/layout.tsx`
 *   확인, `next/font`·`@font-face` 미사용) 상세페이지는 base64로 통째로
 *   저장되는 독립 HTML/CSS라 외부 폰트 네트워크에 기대면 오프라인·CSP
 *   환경에서 깨질 수 있다. 그래서 서로 다른 글꼴 파일을 섞지 않고, OS가
 *   기본으로 갖고 있는 한국어 안전 시스템 폰트 스택 **하나**를 굵기·자간·
 *   숫자 표현(tabular-nums)으로만 역할을 구분한다 — "여러 폰트를
 *   무분별하게 섞지 않는다"는 요청 사양과 "외부 네트워크 없어도 안전
 *   fallback" 요구를 동시에 만족하는 가장 보수적인 선택이다.
 * - `icon`/`accentColor` — 레이아웃(`layout`)에서 결정적으로 도출한다.
 *   장식이 아니라 그 섹션이 실제로 하는 일(주의사항·사양·순서·특징)을
 *   나타내는 아이콘만 배정하고(`product-page-icons.ts`), 근거가 없는
 *   레이아웃(예: 공감형 인용, 순수 사진+본문)에는 아이콘을 붙이지 않는다
 *   (`icon: "none"`) — "단순 장식인지 실제 의미 전달인지 구분한다"는
 *   요청 사양.
 *
 * ## T1-142 확장 — accent 폰트·kicker 라벨·생성형 아이콘/모티프
 *
 * "Display/Headline/Body/Accent 역할을 구분하고 기본 h1/p만 반복하지
 * 않는다"는 요청에 맞춰 역할을 하나 더 나눈다. 한글 Display/Body/Emphasis는
 * 여전히 하나의 한국어 안전 스택을 공유한다(T1-112 사유 그대로 유효 — 이
 * 저장소에는 실제로 다른 한글 글꼴 파일이 없다, `docs/DEVELOPMENT_ENVIRONMENT.md`
 * 확인). 다만 **숫자·영문 kicker 라벨은 라틴 문자라서** 실제로 다른
 * OS 기본 서체를 앞에 붙여도 안전하게 fallback된다 — `numeric`은 Windows
 * 기본 서체 중 tabular 숫자가 뚜렷한 그로테스크(Bahnschrift)를, `accent`는
 * 세리프(Georgia)를 한글 스택 앞에 붙여 "숫자·영문 accent를 적극 활용"
 * 요구를 지어낸 폰트 없이 만족한다. `kicker`는 `LAYOUT_VISUAL_TOKENS`에서
 * `icon`과 같은 방식으로 도출하는 짧은 영문 라벨(예: "SPEC", "STEP") —
 * 사실을 지어내는 것이 아니라 섹션의 구조적 역할을 나타내는 표지판이다.
 * 아이콘/Hero 모티프 자체를 생성형 이미지로 만드는 계획은
 * `product-story-generative-visuals.ts`가 맡고, 실제 렌더링은
 * `product-story-html.ts`가 생성 자산이 있으면 그것을, 없으면 기존
 * SVG/텍스트로 graceful fallback한다.
 */

export type StoryLayoutVariant =
  | "problem-empathy"
  | "feature-highlight"
  | "step-by-step"
  | "spec-panel"
  | "notice"
  | "detail-callout"
  | "components-grid"
  | "image-feature"
  | "image-text"
  | "text-only"
  | "closing";

export interface SectionDesignSpec {
  sectionId: string;
  layout: StoryLayoutVariant;
  /** 이 섹션에서 무엇을 근거로 레이아웃을 골랐는지 — 디버깅·검증용 */
  reason: string;
  /** 이 섹션이 다른 섹션과 시각적으로 구분되도록 번갈아 쓰는 톤(0|1) */
  toneIndex: 0 | 1;
  /** 레이아웃에서 결정적으로 도출한 강조색(hex) — 아이콘·배지·포인트 보더에 쓴다 */
  accentColor: string;
  /** 레이아웃이 실제로 의미를 전달할 때만 배정되는 아이콘. 장식용 아이콘은 없다(T1-112) */
  icon: StoryIconId;
  /** 레이아웃 의미를 나타내는 짧은 영문 kicker 라벨(accent 폰트로 렌더링). 근거 없는 레이아웃은 빈 문자열(T1-142) */
  kicker: string;
}

/** 상세페이지 전체가 공유하는 역할별 글꼴 스택 (T1-112, accent는 T1-142 추가) */
export interface StoryTypography {
  /** Hero 타이틀·섹션 대제목 */
  display: string;
  /** 본문 카피 */
  body: string;
  /** keyMessage·강조 문구 */
  emphasis: string;
  /** 스펙 수치·단계 번호 — tabular-nums로 자리수가 흔들리지 않게 */
  numeric: string;
  /** 영문 kicker 라벨(SPEC·STEP·CAUTION 등) 전용 — 한글과 자연히 섞이지 않는 라틴 문자만 적용된다 */
  accent: string;
}

export interface StoryDesignPlan {
  typography: StoryTypography;
  sections: SectionDesignSpec[];
}

/**
 * 외부 웹폰트 없이 안전하게 fallback하는 한국어 시스템 폰트 스택.
 * 모든 역할이 같은 스택을 공유하되(달라진 typeface가 아니라 굵기/자간/
 * 숫자 표현으로 역할을 구분) — 이유는 위 T1-112 확장 설명 참고.
 */
const KOREAN_SAFE_STACK =
  '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Display/Emphasis 전용 — 실제로 로드되는 한국어 웹폰트(T1-147 요청 사양
 * "실제 로드 가능한 폰트를 사용한다"). T1-112 당시엔 이 저장소에 웹폰트
 * 서버가 없어 시스템 폰트만 썼지만, 이번 요청은 승인된 레퍼런스 시안
 * 수준의 강한 Display 타이포를 명시적으로 요구한다 — Pretendard(SIL
 * OFL, 무료 상업적 사용 가능)를 jsDelivr CDN에서 불러온다
 * (`wrapProductProfileHtmlDocument`의 `<link>`, `packages/core/src/
 * product-profile/product-page-html.ts`). 네트워크가 없거나 CDN이
 * 막히면 브라우저가 자동으로 `KOREAN_SAFE_STACK`으로 graceful
 * fallback한다 — 폰트 로드 실패가 레이아웃을 깨뜨리지 않는다. 본문
 * (`body`)은 여전히 시스템 폰트를 쓴다 — 큰 제목 몇 곳에만 다른 폰트를
 * 적용해 "여러 폰트를 무분별하게 섞지 않는다"는 원래 원칙을 지킨다.
 */
const KOREAN_DISPLAY_STACK = `"Pretendard Variable", "Pretendard", ${KOREAN_SAFE_STACK}`;

/**
 * 숫자(step 번호·spec 큰 수치) 전용 — Windows 기본 탑재 그로테스크
 * (Bahnschrift)를 라틴 숫자에만 적용하고, 그 서체가 없는 OS/한글 글자는
 * 한국어 안전 스택으로 그대로 fallback한다(라틴 전용 서체는 한글 글리프가
 * 없어 자동으로 다음 스택으로 넘어간다 — 브라우저 표준 동작).
 */
const NUMERIC_ACCENT_STACK = `"Bahnschrift", "Segoe UI Semibold", ${KOREAN_SAFE_STACK}`;

/**
 * 영문 kicker 라벨(SPEC·STEP·CAUTION 등) 전용 — 세리프(Georgia)로 한글
 * 그로테스크 헤드라인과 확실히 다른 질감을 준다. 같은 이유로 한글에는
 * 적용되지 않고 한국어 안전 스택으로 fallback된다.
 */
const ENGLISH_ACCENT_STACK = `"Georgia", "Times New Roman", ${KOREAN_SAFE_STACK}`;

export const STORY_TYPOGRAPHY: StoryTypography = {
  display: KOREAN_DISPLAY_STACK,
  body: KOREAN_SAFE_STACK,
  emphasis: KOREAN_DISPLAY_STACK,
  numeric: NUMERIC_ACCENT_STACK,
  accent: ENGLISH_ACCENT_STACK,
};

/**
 * 레이아웃 → (강조색, 아이콘) 결정 테이블. 레이아웃 자체가 이미 "이
 * 섹션이 무엇을 하는가"에서 도출됐으므로(`classifySection`), 그 의미에
 * 맞는 시각 신호만 덧붙인다 — 존재하지 않는 인증·성능을 암시하는 색/
 * 아이콘(예: 금색 별)은 테이블에 없다.
 */
/**
 * T1-147 — 승인된 시안 기준 색 방향(teal/blue + neutral)으로 통일한다.
 * 이전에는 레이아웃마다 서로 다른 색상군(amber/violet/slate 등)을 썼는데,
 * 페이지 전체를 스크롤했을 때 색이 산발적으로 바뀌어 "하나의 브랜드
 * 페이지"라는 일관성이 떨어졌다. 주의사항(notice)만은 의미상 경고색이
 * 필요해 예외로 유지한다 — 그 외 모든 레이아웃은 teal/blue 계열 안에서
 * 명도만 다르게 써서 섹션은 구분되되 색 언어는 하나로 유지한다.
 */
const LAYOUT_VISUAL_TOKENS: Record<StoryLayoutVariant, { accentColor: string; icon: StoryIconId; kicker: string }> = {
  notice: { accentColor: "#b45309", icon: "warning", kicker: "CAUTION" },
  // spec-panel은 T1-126부터 어두운 full-bleed 밴드 위에 큰 숫자로 렌더링된다
  // (product-story-html.ts) — 어두운 배경에서 대비가 살도록 밝은 색을 쓴다.
  "spec-panel": { accentColor: "#38bdf8", icon: "spec", kicker: "SPEC" },
  "step-by-step": { accentColor: "#0369a1", icon: "steps", kicker: "HOW TO" },
  "feature-highlight": { accentColor: "#0f766e", icon: "check", kicker: "FEATURE" },
  "problem-empathy": { accentColor: "#64748b", icon: "none", kicker: "" },
  "detail-callout": { accentColor: "#155e75", icon: "info", kicker: "DETAIL" },
  // components-grid는 여러 구성품을 한 눈에 세는 화면이라(box 아이콘),
  // detail-callout(단일 클로즈업)과는 다른 명도의 같은 blue 계열을 쓴다.
  "components-grid": { accentColor: "#1d4ed8", icon: "box", kicker: "INCLUDED" },
  "image-feature": { accentColor: "#0e7490", icon: "check", kicker: "FEATURE" },
  "image-text": { accentColor: "#0f766e", icon: "none", kicker: "" },
  "text-only": { accentColor: "#334155", icon: "none", kicker: "" },
  closing: { accentColor: "#0f172a", icon: "none", kicker: "" },
};

const NOTICE_PATTERN = /주의사항|주의|경고|보증|A\/S|안전/;
const SPEC_PATTERN = /사양|스펙|구성품?|규격|치수/;
const STEP_PATTERN = /사용\s?방법|사용법|사용\s?순서|단계별?/;
const PROBLEM_PATTERN = /문제|불편|고민|필요한\s?이유|어떤\s?상황/;
// 클로즈업/디테일 촬영을 의도한 섹션만 detail-callout으로 보낸다 — 카피 길이
// 기준(T1-126 이전)은 헤드라인+짧은 카피 원칙이 적용된 뒤로는 거의 모든
// 섹션이 "짧은 카피"가 되어 신호로서 의미가 없어졌다(T1-126 실측: Playwright
// 프리뷰에서 실제 사용 장면 섹션까지 전부 detail-callout으로 쏠리는 것을
// 확인). 목적(purpose/keyMessage)에 명시적으로 클로즈업 의도가 있을 때만
// 이 레이아웃을 쓴다.
const DETAIL_PATTERN = /디테일|클로즈업|확대\s?컷?/;

/**
 * 섹션 하나의 레이아웃을 정한다. 우선순위: 주의/보증(notice) →
 * 사양/구성(spec-panel) → 사용 순서(step-by-step) → 마지막 섹션의 감성적
 * 마무리(closing, T1-118) → 문제 제기(problem-empathy, 이미지 없이 공감
 * 문구 강조) → 특징 카드(feature-highlight, 근거 2개 이상) → 디테일
 * 캡션(detail-callout, 이미지 있고 클로즈업/디테일 의도 명시) → 사진+근거 강조(image-feature,
 * 이미지 있고 본문이 길면서 근거도 있음, T1-118) → 사진+본문(image-text,
 * 근거 없이 서술만) → 텍스트 전용(text-only).
 *
 * `image-feature`는 T1-118 실측(실제 Benchmark Story 호출 결과)에서
 * 발견한 문제를 고친다 — `productFacts`가 있는데도 `image-text` 레이아웃은
 * 카피만 렌더링하고 근거를 아예 보여주지 않아, 애써 모은 사실이 화면에서
 * 조용히 사라지고 있었다. 근거가 있으면 짧은 강조 목록으로 함께 보여준다.
 *
 * `closing`은 주의/사양/사용법처럼 사실 전달이 목적인 레이아웃보다
 * 우선순위가 낮다 — 마지막 섹션이라도 주의사항이면 여전히 notice여야
 * 한다(T1-118 요청 사양 "허위 주장 없이 감성적으로 정리"는 사실 전달
 * 섹션을 감성 섹션으로 바꾸라는 뜻이 아니다). 섹션이 3개 미만이면
 * 마지막 섹션도 closing으로 분리하지 않는다 — 근거 없는 섹션 분리를
 * 강제하지 않는다는 Story Planner 원칙과 같은 이유.
 *
 * `imageRole`(카테고리) 기반 우선 배정 (T1-138) — `DETAIL_PATTERN`은
 * purpose/keyMessage에 "디테일"·"클로즈업"·"확대컷" 같은 **문자 그대로의
 * 표현**이 있을 때만 반응한다. 그런데 Image Studio에서 이미 DETAIL
 * 카테고리로 분류·선택된 실제 클로즈업 사진이 배정된 섹션인데도 LLM이
 * purpose를 "제품의 세부 사항 설명"처럼 다른 말로 쓰면 이 규칙을
 * 놓치고 일반 image-feature로 떨어진다(T1-138 실측: Benchmark Story
 * 실제 호출에서 재현). 카테고리 자체가 이미 사람이 검증한 "이건
 * 클로즈업 사진"이라는 사실이므로, 키워드보다 먼저 믿는다. 같은 이유로
 * COMPONENTS 카테고리는 "구성품을 나열해 보여준다"는 목적이 이미
 * 명확하므로 키워드 없이도 전용 그리드 레이아웃으로 보낸다 — 여러
 * 섹션이 전부 image-feature로 수렴해 "레이아웃 이름은 다양한데 실제
 * 화면은 똑같다"는 문제(T1-138 요청 사양 "동일한 레이아웃 반복")를
 * 줄인다.
 */
function classifySection(
  section: ProductStorySection,
  isLastOfAtLeastThree: boolean,
): { layout: StoryLayoutVariant; reason: string } {
  const text = `${section.purpose} ${section.keyMessage}`;
  const hasImage = section.imageRole !== "NONE";
  const factCount = section.productFacts.length;

  if (NOTICE_PATTERN.test(text)) {
    return { layout: "notice", reason: "purpose/keyMessage에 주의·보증 관련 표현" };
  }
  // 카테고리(imageRole) 기반 배정은 SPEC_PATTERN보다 먼저 본다 — 구성품
  // 사진이 배정된 섹션은 purpose에 거의 항상 "구성품"이라는 단어가
  // 들어가 SPEC_PATTERN(`구성품?`)과 그대로 겹친다. 그런데 그 값은 사람이
  // Image Studio에서 이미 "이건 구성품 사진"이라고 검증한 카테고리라서,
  // 느슨한 텍스트 정규식보다 더 신뢰할 수 있는 신호다(T1-138, 위 함수
  // 설명 참고) — 그래서 여기서 먼저 소비한다.
  if (section.imageRole === "DETAIL") {
    return { layout: "detail-callout", reason: "이미지 카테고리가 DETAIL(클로즈업 사진으로 이미 검증됨)" };
  }
  if (section.imageRole === "COMPONENTS" && factCount >= 1) {
    return { layout: "components-grid", reason: "이미지 카테고리가 COMPONENTS + 근거 있음 — 구성품 그리드로 나열" };
  }
  if (SPEC_PATTERN.test(text) && factCount >= 1) {
    return { layout: "spec-panel", reason: "purpose/keyMessage에 사양·구성 표현 + 근거 있음" };
  }
  if (STEP_PATTERN.test(text) && factCount >= 2) {
    return { layout: "step-by-step", reason: "사용 순서 표현 + 근거 2개 이상" };
  }
  if (isLastOfAtLeastThree) {
    return { layout: "closing", reason: "마지막 섹션(3개 이상 구성) — 감성적 마무리" };
  }
  if (!hasImage && PROBLEM_PATTERN.test(text)) {
    return { layout: "problem-empathy", reason: "이미지 없음 + 문제 제기 표현" };
  }
  if (!hasImage && factCount >= 2) {
    return { layout: "feature-highlight", reason: "이미지 없음 + 근거 2개 이상 — 카드형 나열" };
  }
  if (hasImage && DETAIL_PATTERN.test(text)) {
    return { layout: "detail-callout", reason: "이미지 있음 + 클로즈업/디테일 의도 명시" };
  }
  if (hasImage && factCount >= 1) {
    return { layout: "image-feature", reason: "이미지 있음 + 본문 카피 + 근거 있음 — 근거를 함께 강조" };
  }
  if (hasImage) {
    return { layout: "image-text", reason: "이미지 있음 + 본문 카피, 근거 없음" };
  }
  return { layout: "text-only", reason: "이미지 없음, 다른 조건 미해당" };
}

/**
 * Story 전체의 Design Plan을 만든다. `renderProductStoryHtml`이 이 결과를
 * 받아 섹션마다 다른 마크업/CSS 클래스를 적용한다.
 */
export function planStoryDesign(story: ProductStory): StoryDesignPlan {
  const total = story.sections.length;
  return {
    typography: STORY_TYPOGRAPHY,
    sections: story.sections.map((section, index) => {
      const isLastOfAtLeastThree = total >= 3 && index === total - 1;
      const { layout, reason } = classifySection(section, isLastOfAtLeastThree);
      const { accentColor, icon, kicker } = LAYOUT_VISUAL_TOKENS[layout];
      return {
        sectionId: section.sectionId,
        layout,
        reason,
        toneIndex: (index % 2) as 0 | 1,
        accentColor,
        icon,
        kicker,
      };
    }),
  };
}

/**
 * 레이아웃 종류가 얼마나 다양한지 — Quality Critic이 "모든 섹션이 같은
 * 템플릿"인지 판단할 때 쓴다. 섹션이 1~2개뿐이면 다양성을 요구하지 않는다
 * (근거 없는 섹션을 억지로 나누지 않는다는 Story Planner 원칙과 같은 이유).
 */
export function countDistinctLayouts(plan: StoryDesignPlan): number {
  return new Set(plan.sections.map((s) => s.layout)).size;
}

/** 같은 레이아웃이 3개 이상 연속되는지 — "사진만 연속 나열"과 같은 종류의 단조로움 신호 */
export function hasMonotonousLayoutRun(plan: StoryDesignPlan, minRun = 3): boolean {
  let run = 1;
  for (let i = 1; i < plan.sections.length; i += 1) {
    if (plan.sections[i].layout === plan.sections[i - 1].layout) {
      run += 1;
      if (run >= minRun) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/**
 * 섹션이 2개 이상인데 강조색·아이콘이 전부 똑같은지 — "레이아웃 이름은
 * 다양한데 실제로는 단일 색·단일(또는 무) 아이콘이라 시각적으로
 * 구분되지 않는다"는 상태를 잡는다(T1-112). 요청 사양 "아이콘/강조/
 * 레이아웃 variation이 전혀 없는지 검사" 중 레이아웃 다양성은
 * `countDistinctLayouts`/`hasMonotonousLayoutRun`이 이미 보고, 이
 * 함수는 색·아이콘 축을 본다.
 */
export function hasNoVisualVariation(plan: StoryDesignPlan): boolean {
  if (plan.sections.length < 2) return false;
  const distinctColors = new Set(plan.sections.map((s) => s.accentColor)).size;
  const distinctIcons = new Set(plan.sections.map((s) => s.icon)).size;
  return distinctColors <= 1 && distinctIcons <= 1;
}

/**
 * 주의사항/보증(NOTICE_PATTERN)에 해당하는 Story Section을 서사에서
 * 제거한다. (T1-147)
 *
 * `product-story-facts-panel.ts`(T1-139)가 검증된 `ProductProfile.warnings`
 * 만으로 "사용상 주의사항"을 최종 페이지 맨 아래에 **항상 한 번** 붙인다.
 * 그런데 Story Planner(LLM)도 같은 주제로 별도 섹션을 만들 수 있어(프롬프트
 * 기본 흐름에 "구매 전 확인/주의사항"이 포함돼 있었다), 두 출처가 서로
 * 모르는 채 동시에 렌더링되면 페이지에 같은 내용이 두 번 나타난다 — 이
 * 함수가 그 중복을 원천에서 막는다. LLM이 쓴 주의사항 카피 자체는
 * 버려진다(사실이 아니라서가 아니라, 검증된 구조화 데이터가 이미 같은
 * 내용을 더 정확하게 보여주기 때문 — 정보가 사라지는 것이 아니라 출처가
 * 하나로 정리되는 것이다).
 *
 * 이 필터를 적용한 결과 섹션이 하나도 안 남으면(이론상 모든 섹션이
 * 주의사항으로만 구성된 극단적 응답) 아무것도 지우지 않는다 — 빈 Story를
 * 만드는 것보다 중복을 감수하는 편이 안전하다.
 */
export function dropRedundantNoticeSections(story: ProductStory): ProductStory {
  const kept = story.sections.filter((section) => !NOTICE_PATTERN.test(`${section.purpose} ${section.keyMessage}`));
  if (kept.length === 0) return story;
  return { ...story, sections: kept };
}
