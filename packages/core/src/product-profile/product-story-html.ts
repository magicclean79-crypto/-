import type { ProductStory } from "./product-story";
import type { AssignedStorySection } from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";
import { planStoryDesign, type SectionDesignSpec, type StoryDesignPlan } from "./product-story-design";
import type { StoryIconId } from "./product-page-icons";
import type { AuxiliaryVisualAsset } from "./product-story-auxiliary-visual";
import type { GenerativeVisualAsset } from "./product-story-generative-visuals";
import { buildStoryVisualTokens } from "./product-composition-art-direction";
import type { IconFamilyId, ResolvedComposition, ResolvedDesignProfile } from "./design-profile";
import { resolveComposition } from "./design-profile";
import { familyIconMarkup } from "./icon-family-registry";

/**
 * Product Story → HTML/CSS 렌더러. (T1-94, 2026-08-12 / T1-97, Design Spec 반영
 * / T1-112, 타이포그래피·아이콘·Gemini 보조 그래픽 반영)
 *
 * `product-page-html.ts`(기존 Template V1/A~E)는 건드리지 않는다 —
 * Story는 그 템플릿들과 다른 원칙(섹션마다 목적·근거·전환 논리가 명시된
 * 구조)으로 조립되므로 별도 렌더러를 둔다. 기존 템플릿의 시각 언어
 * (`.pde-page` 스코프, 아이콘 배지, 480px 모바일 폭)를 그대로 따라 두
 * 결과물이 같은 쇼핑몰 안에서 이질감이 없게 한다.
 *
 * LLM 호출 없음 — 순수 함수(부작용 없음). 입력은 이미 LLM이 만든 Story +
 * 이미 배정이 끝난 실제 이미지 + Design Spec(`product-story-design.ts`,
 * 섹션마다 다른 레이아웃·타이포그래피·아이콘·강조색)뿐이다. Design Spec을
 * 넘기지 않으면 내부에서 `planStoryDesign`으로 직접 계산한다 — 기존
 * 2-인자 호출부와 호환된다.
 *
 * ## T1-112 — 누가 무엇을 결정하는가
 *
 * - **카피**: LLM(가능하면 Claude, `apps/api/src/product-profile/
 *   product-profile.service.ts`의 `generateStory`)이 섹션별 문구를 쓴다.
 * - **디자인**: 이 렌더러와 `product-story-design.ts`가 결정한다 — LLM이
 *   아니라 Story Section의 이미 검증된 필드(레이아웃·이미지 유무)에서
 *   결정적으로 도출한다(비용 없음, 항상 같은 입력 → 같은 결과).
 * - **실제 제품 이미지**: Gemini가 만들고 사람이 Image Studio에서 선택한
 *   것(`StudioSelectedImage`) — 이 렌더러는 그 선택 결과만 받는다.
 * - **보조 그래픽**(`auxiliaryVisuals`, 선택적): Gemini가 별도 역할로
 *   생성하는 장식용 추상 그래픽(`product-story-auxiliary-visual.ts`) —
 *   실제 제품 사진이 없는 섹션에만, 실제 제품 사진을 대체하지 않는
 *   자리에만 배치한다. `data-visual-source="gemini-auxiliary"`로 실제
 *   제품 사진과 DOM에서 구분되게 표시한다.
 * - **아이콘**(T1-177): DESIGN_PROFILE.iconStyle(`design-profile.ts`)이 고른
 *   family가 `icon-family-registry.ts`의 canonical SVG 중 어떤 것을 쓸지
 *   100% 결정한다 — profile이 없으면 `technical-outline`(기존 baseline)을
 *   쓴다. `product-story-generative-visuals.ts`가 계획하고 Gemini가 만드는
 *   생성형 아이콘 자산(T1-142, `generativeVisuals.icons`)은 **더 이상 최종
 *   HTML에 주입되지 않는다** — DESIGN_PROFILE이 우회당하지 않도록, 임의의
 *   AI 생성 이미지 대신 항상 registry의 canonical SVG만 렌더링한다(요청
 *   사양 "AI가 arbitrary SVG를 생성하는 구조는 허용하지 않는다"). 생성 자체는
 *   호출자(`product-profile.service.ts`)가 감사·리포트 목적으로 계속 시도할
 *   수 있지만, 이 렌더러는 그 결과를 읽지 않는다.
 * - **Hero 모티프**(`generativeVisuals.heroMotif`, 선택적, T1-142): 아이콘과
 *   달리 특정 의미를 가진 UI 요소가 아니라 장식용 배경 그래픽이라 이
 *   가드레일 대상이 아니다 — 있으면 쓰고, 없으면(생성 실패·imageGen
 *   미연결 등) 아무것도 그리지 않는다(graceful fallback).
 * - **kicker 라벨**: 레이아웃 의미를 나타내는 짧은 영문 라벨(SPEC·STEP 등,
 *   `product-story-design.ts`의 `LAYOUT_VISUAL_TOKENS.kicker`) — 이미지가
 *   아니라 accent 폰트로 렌더링되는 순수 텍스트다. 근거 없는 레이아웃에는
 *   빈 문자열이라 아무것도 그리지 않는다.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * DESIGN_PROFILE의 iconStyle(T1-176/T1-177)을 canonical SVG 아이콘에
 * 적용한다. 아이콘 registry(`icon-family-registry.ts`)의 path data 자체는
 * 절대 바꾸지 않는다 — stroke-width/stroke-linecap/stroke-linejoin/width/
 * height 속성만 치환한다("icon family는 현재 프로젝트의 SVG icon
 * registry에서만 선택한다" 요청 사양). `data-icon-source="design-profile-
 * svg"` 뱃지 안의 SVG만 대상으로 하는 것은 호출부(`applyIconStyleToHtml`)가
 * 보장한다.
 */
function applyIconStyleAttrs(svg: string, style: { strokeWidth: number; size: number; linecap: "round" | "square"; linejoin: "round" | "miter" }): string {
  return svg
    .replace(/stroke-width="[\d.]+"/g, `stroke-width="${style.strokeWidth}"`)
    .replace(/width="\d+" height="\d+"/, `width="${style.size}" height="${style.size}"`)
    .replace(/stroke-linecap="(round|square|butt)"/g, `stroke-linecap="${style.linecap}"`)
    .replace(/stroke-linejoin="(round|miter|bevel)"/g, `stroke-linejoin="${style.linejoin}"`);
}

/** `sectionsHtml` 전체에서 DESIGN_PROFILE canonical SVG 아이콘 뱃지를 골라 스타일을 적용한다 */
function applyIconStyleToHtml(
  html: string,
  style: { strokeWidth: number; size: number; linecap: "round" | "square"; linejoin: "round" | "miter" },
): string {
  return html.replace(
    /(<span class="pde-story-icon" data-icon-source="design-profile-svg" aria-hidden="true">)([\s\S]*?)(<\/span>)/g,
    (_match, open: string, svg: string, close: string) => `${open}${applyIconStyleAttrs(svg, style)}${close}`,
  );
}

function dataUri(image: StudioSelectedImage): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

function zoomLink(image: StudioSelectedImage, inner: string): string {
  return `<a href="${dataUri(image)}" target="_blank" rel="noopener" aria-label="원본 크기로 보기">${inner}</a>`;
}

/**
 * 이 사진이 어느 productId/section/category/purpose/version에서 왔는지를
 * DOM에 그대로 남긴다(T1-144 요청 사양 5 — "asset에 productId/sectionId/
 * category/purpose/sourceReferenceIds/version 등의 매핑 정보를 유지"). 새
 * 데이터를 만들지 않는다 — 이미 `StudioSelectedImage`·`AssignedStorySection`
 * 이 갖고 있는 값을 속성으로 노출할 뿐이라, 브라우저 검증(개발자 도구로
 * "이 사진이 실제로 이 섹션 목적에 맞는 asset인지" 확인)과 자동 검사 양쪽에
 * 근거가 남는다.
 */
function assetDataAttrs(image: StudioSelectedImage, sectionId: string, purpose: string): string {
  const source = image.source ?? "generated";
  // T1-166 — imageRole/autoTrim은 렌더러가 지어내지 않는다. 값이 없으면
  // (기존 호출부·테스트 픽스처) 빈 속성만 남긴다 — 없는 사실을 채우지 않는다.
  const imageRole = image.imageRole ?? "";
  const autoTrim =
    typeof image.autoTrimMarginRatio === "number" ? `${Math.round(image.autoTrimMarginRatio * 100)}pct` : "none";
  return (
    `data-asset-id="${escapeHtml(image.imageId)}" data-asset-category="${escapeHtml(image.category)}" ` +
    `data-asset-source="${source}" data-asset-section-id="${escapeHtml(sectionId)}" ` +
    `data-asset-purpose="${escapeHtml(purpose)}" data-asset-version="${image.groupVersion ?? ""}" ` +
    `data-image-role="${escapeHtml(imageRole)}" data-auto-trim="${autoTrim}"`
  );
}

/**
 * Canonical image frame registry (T1-183) — hero/split/gallery가 쓸 수
 * 있는 종횡비는 `design-profile.ts`의 enum(`HERO_ASPECTS`/`SPLIT_ASPECTS`/
 * `GALLERY_CELL_ASPECTS`)으로만 제한된다. 이 함수는 그 enum 문자열을
 * CSS `aspect-ratio` 값으로 결정적으로 변환할 뿐, 새 값을 만들지 않는다 —
 * registry의 유일한 출처는 여전히 `design-profile.ts`다.
 */
const FRAME_ASPECT_CSS: Record<string, string> = {
  "16:9": "16 / 9",
  "4:3": "4 / 3",
  "4:5": "4 / 5",
  square: "1 / 1",
};
function frameAspectCss(id: string): string {
  return FRAME_ASPECT_CSS[id] ?? "4 / 3";
}

/**
 * 대표 이미지 외에 같은 섹션에 함께 붙는 추가 사진들 — 구성품 전부·디테일
 * 여러 컷처럼 "한 장으로는 부족한" 카테고리에서 쓴다(T1-144). 대표 이미지와
 * 같은 zoom 링크·asset 속성을 갖되, 더 작은 썸네일 그리드로 렌더링된다.
 *
 * T1-183 — 셀마다 auto-height로 제각각 크기이던 것을, composition의
 * canonical gallery 종횡비/열 수(`ResolvedComposition.gallery`)로 통일한다
 * (요청 사양 "모든 이미지가 동일한 canonical cell geometry를 따르도록,
 * 이미지별 독립 auto-height 금지"). object-fit:contain은 그대로 유지해
 * 실제 asset 비율은 crop하지 않는다 — 셀 "박스"만 통일하고 그 안의 이미지는
 * 잘리지 않는다.
 */
function galleryStrip(
  images: StudioSelectedImage[],
  sectionId: string,
  purpose: string,
  composition: ResolvedComposition,
): string {
  if (images.length === 0) return "";
  const items = images
    .map(
      (image) =>
        `<li>${zoomLink(
          image,
          `<img src="${dataUri(image)}" alt="" loading="lazy" ${assetDataAttrs(image, sectionId, purpose)}>`,
        )}</li>`,
    )
    .join("");
  const cellAspect = frameAspectCss(composition.gallery.cellAspect);
  return `<ul class="pde-story-gallery-strip" data-gallery-count="${images.length}" style="--pde-gallery-cell-aspect:${cellAspect};--pde-gallery-columns:${composition.gallery.columns};">${items}</ul>`;
}

/**
 * Hero 제품 사진 선택 (T1-183). **근본 원인**: T1-173이 페이지 최상단
 * 전용 HERO 블록 자체를 렌더러에서 제거했다 — HERO 카테고리 이미지는
 * 여전히 Image Studio에서 검증되고 Story 섹션에도 정상 배정되지만, 그
 * 이후로는 다른 섹션과 완전히 동일하게만 보여 "이 사진이 대표 사진"이라는
 * 표시가 페이지 어디에도 남지 않았다. 이 함수는 새 이미지를 만들거나
 * 임의로 고르지 않는다 — Image Studio에서 사람이 이미 선택(검증)한 실제
 * 제품 사진(`StudioSelectedImage`) 중에서만, 아래 우선순위로 고른다.
 *
 * 1) Story 섹션의 `imageRole`(카테고리)이 "HERO"로 배정된 대표 이미지 —
 *    단, asset-level `image.imageRole`(T1-166, `product-page-images.ts`)이
 *    "lifestyle"(사용 장면 연출)이면 제외한다.
 * 2) 그 외 대표 이미지 중 asset-level이 "lifestyle"이 아닌(=고립형 실제
 *    제품 사진) 것을 카테고리 우선순위(HERO > FEATURE_HIGHLIGHT > DETAIL >
 *    OTHER > COMPONENTS)로 고른다. OCR/포장/사양표 사진은 애초에
 *    `StudioSelectedImage` 목록에 들어오지 않는다(호출자가 이미 제외,
 *    `product-story.ts` 상단 주석).
 *
 * 둘 다 없으면 `null` — 이 렌더러의 안전한 fallback은 "hero 블록 자체를
 * 그리지 않는다"이지, 검증되지 않은 사진을 대신 쓰는 것이 아니다.
 */
const HERO_FALLBACK_CATEGORY_PRIORITY = ["HERO", "FEATURE_HIGHLIGHT", "DETAIL", "OTHER", "COMPONENTS"];

function selectHeroImage(assignedSections: AssignedStorySection[]): StudioSelectedImage | null {
  const heroAssignment = assignedSections.find(
    (item) => item.section.imageRole === "HERO" && item.image && item.image.imageRole !== "lifestyle",
  );
  if (heroAssignment?.image) return heroAssignment.image;

  const verifiedByCategory = new Map<string, StudioSelectedImage>();
  for (const item of assignedSections) {
    if (!item.image || item.image.imageRole === "lifestyle") continue;
    if (!verifiedByCategory.has(item.image.category)) {
      verifiedByCategory.set(item.image.category, item.image);
    }
  }
  for (const category of HERO_FALLBACK_CATEGORY_PRIORITY) {
    const candidate = verifiedByCategory.get(category);
    if (candidate) return candidate;
  }
  return null;
}

/** 위 4개(최대) feature를 icon+label 리스트 마크업으로 렌더링한다(T1-183) — pill 남발 금지, 아이콘+짧은 텍스트 한 줄뿐이다 */
function heroFeatureListHtml(
  features: { icon: Exclude<StoryIconId, "none">; label: string }[],
  iconFamily: IconFamilyId,
): string {
  if (features.length === 0) return "";
  const items = features
    .map(
      (item) =>
        `<li class="pde-story-hero-feature"><span class="pde-story-icon" data-icon-source="design-profile-svg" aria-hidden="true">${familyIconMarkup(iconFamily, item.icon)}</span><span class="pde-story-hero-feature-label">${escapeHtml(item.label)}</span></li>`,
    )
    .join("");
  return `<ul class="pde-story-hero-features">${items}</ul>`;
}

export interface ProductStoryHtmlResult {
  html: string;
  css: string;
}

/**
 * 생성형 아이콘/Hero 모티프 자산을 렌더러가 쓰기 좋은 형태로 묶은 것 (T1-142).
 * T1-177 — `icons`는 더 이상 이 렌더러가 DOM에 그리는 데 쓰이지 않는다
 * (`renderProductStoryHtml`은 이 필드를 읽지 않는다) — 아이콘은 항상
 * DESIGN_PROFILE.iconStyle.family가 고른 canonical SVG로 그려진다. 호출자
 * (`product-profile.service.ts`)가 감사/리포트 목적으로 계속 채워 넘길 수
 * 있으므로 타입은 유지한다.
 */
export interface GenerativeVisualBundle {
  icons: Partial<Record<StoryIconId, GenerativeVisualAsset>>;
  heroMotif: GenerativeVisualAsset | null;
}

function generativeAssetDataUri(asset: GenerativeVisualAsset): string {
  return `data:${asset.mimeType};base64,${asset.base64}`;
}

/** productFacts를 목록으로 렌더링한다 — step-by-step/feature-highlight/image-feature/notice가 공유 */
function factList(facts: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const items = facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("");
  return `<${tag} class="pde-story-facts">${items}</${tag}>`;
}

/**
 * spec-panel 전용 렌더링 — "라벨: 값" 형태의 fact는 값을 큰 숫자처럼 분리해
 * 보여준다(요청 사양 "큰 숫자·짧은 라벨을 적극 활용"). 콜론이 없는 fact는
 * 값 하나로만 표시한다. 값을 지어내지 않는다 — 원문 fact 문자열을 그대로
 * 나누기만 한다(추가 사실 생성 없음).
 */
function specFactGrid(facts: string[]): string {
  // 값이 여러 단어로 된 구절(예: "스테인리스 호스")이면 42px 굵은 숫자
  // 크기로는 줄바꿈이 생겨 어색해진다 — 공백 없는 짧은 수치·단어(예:
  // "3M"·"스테인리스")만 큰 숫자로 강조하고, 여러 단어 구절은 절제된
  // 크기로 표시한다(T1-126 프리뷰 실측 발견).
  const LONG_VALUE_THRESHOLD = 8;
  const items = facts
    .map((fact) => {
      const match = fact.match(/^([^:：]{1,12})[:：]\s*(.+)$/);
      const value = (match ? match[2] : fact).trim();
      const isLong = /\s/.test(value) || value.length > LONG_VALUE_THRESHOLD;
      const valueClass = isLong ? "pde-story-spec-value pde-story-spec-value--long" : "pde-story-spec-value";
      if (match) {
        const [, label] = match;
        return `<li><span class="${valueClass}">${escapeHtml(value)}</span><span class="pde-story-spec-label">${escapeHtml(label.trim())}</span></li>`;
      }
      return `<li><span class="${valueClass}">${escapeHtml(value)}</span></li>`;
    })
    .join("");
  return `<ul class="pde-story-facts pde-story-spec-grid">${items}</ul>`;
}

/**
 * components-grid 전용 렌더링 — 구성품 각각을 개별 카드로 나열한다
 * (요청 사양 "detail 4-grid"류 카드 그리드). 값을 지어내지 않는다 —
 * `productFacts` 원문(예: "고무 패킹 2개")을 카드 하나에 그대로 담을
 * 뿐이다.
 */
function componentsGrid(facts: string[]): string {
  const items = facts
    .map(
      (fact, index) =>
        `<li><span class="pde-story-components-index">${index + 1}</span><span class="pde-story-components-label">${escapeHtml(fact)}</span></li>`,
    )
    .join("");
  return `<ul class="pde-story-facts pde-story-components-grid">${items}</ul>`;
}

/**
 * 레이아웃별 아이콘 배지 — icon이 "none"이면 아무것도 그리지 않는다(장식용
 * 아이콘 없음, T1-112). T1-177 — DESIGN_PROFILE.iconStyle.family가 고른
 * canonical SVG(`icon-family-registry.ts`)만 렌더링한다. 생성형 아이콘
 * (T1-142)은 더 이상 이 자리에 주입되지 않는다 — DESIGN_PROFILE의 최종
 * 결정권을 임의의 AI 생성 이미지가 우회하지 못하게 하기 위한 의도적 변경
 * (요청 사양 "최종 HTML에 arbitrary generated SVG를 주입하지 않는다").
 */
function iconBadge(design: SectionDesignSpec, iconFamily: IconFamilyId): string {
  if (design.icon === "none") return "";
  return `<span class="pde-story-icon" data-icon-source="design-profile-svg" aria-hidden="true">${familyIconMarkup(iconFamily, design.icon)}</span>`;
}

/**
 * 레이아웃 의미를 나타내는 짧은 영문 kicker 라벨(accent 폰트, 순수 텍스트) —
 * 빈 문자열이면 아무것도 그리지 않는다(T1-142). kicker가 있는 섹션에만
 * (근거 없는 레이아웃에는 장식을 붙이지 않는다는 원칙 그대로) 섹션의 실제
 * 순서(`index`)를 2자리 번호로 함께 보여준다(T1-163 요청 사양 "번호/eyebrow"
 * — 지어낸 값이 아니라 이미 `data-section-index`로 노출되던 값을 눈에
 * 보이는 editorial eyebrow로 재사용할 뿐이다).
 */
function kickerLabel(design: SectionDesignSpec, index: number): string {
  if (!design.kicker) return "";
  const orderNumber = String(index + 1).padStart(2, "0");
  return `<span class="pde-story-kicker"><span class="pde-story-kicker-index" aria-hidden="true">${orderNumber}</span><span class="pde-story-kicker-text">${escapeHtml(design.kicker)}</span></span>`;
}

/**
 * 헤드라인 전체가 아니라 마지막 한 어절만 accent gradient로 강조한다
 * (T1-164 — 이전엔 헤드라인 전체가 gradient라 "단조로운 색" 지적을
 * 받았다, 레퍼런스 시안은 핵심 단어 하나만 강조한다). 어떤 단어가
 * "핵심"인지 지어내지 않는다 — 문장 마지막 어절을 결정적으로 고른다
 * (한국어 문장은 핵심 명사·수식어가 문미에 오는 경우가 많다). 한
 * 단어뿐이면 그 단어 전체를 강조한다.
 */
function highlightHeadline(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return `<span class="pde-story-headline-accent">${escapeHtml(words[0])}</span>`;
  }
  const lead = words.slice(0, -1).join(" ");
  const last = words[words.length - 1];
  return `${escapeHtml(lead)} <span class="pde-story-headline-accent">${escapeHtml(last)}</span>`;
}

/**
 * 이 섹션에 배정된 Gemini 보조 그래픽(있으면)을 배경 레이어로 렌더링한다.
 * 실제 제품 사진(`image`)이 있으면 절대 쓰지 않는다 — 호출자
 * (`renderSection`)가 `image`가 없을 때만 이 함수를 부른다. `data-visual-
 * source="gemini-auxiliary"`로 실제 제품 사진과 DOM에서 구분한다(요청
 * 사양 "asset metadata로 구분").
 */
function auxiliaryVisualLayer(asset: AuxiliaryVisualAsset | undefined): string {
  if (!asset) return "";
  return `<span class="pde-story-aux-visual" data-visual-source="gemini-auxiliary" data-visual-role="${asset.role}" style="background-image:url('data:${asset.mimeType};base64,${asset.base64}')" aria-hidden="true"></span>`;
}

/**
 * Story Section 하나를 Design Spec에 맞는 마크업으로 렌더링한다. 모든
 * 섹션을 같은 "사진 → 카피" 구조로 반복하지 않는다 — 요청 사양이 금지한
 * 패턴이다(T1-97).
 */
function renderSection(
  item: AssignedStorySection,
  index: number,
  design: SectionDesignSpec,
  auxiliaryVisual: AuxiliaryVisualAsset | undefined,
  iconFamily: IconFamilyId,
  composition: ResolvedComposition,
): string {
  const { section, image } = item;
  const kicker = kickerLabel(design, index);
  // T1-173 — 이 섹션에 배정된 사진은 항상 그린다. HERO가 있던 시절에는
  // 첫 이미지가 Hero에도 쓰여 본문에서 중복 표시를 생략했지만(hideMedia),
  // HERO 자체를 없앤 지금은 숨길 이유가 없다 — 그대로 두면 그 섹션의
  // 실제 제품 사진이 페이지 어디에도 나타나지 않게 된다("다른 섹션에서
  // 사용되는 실제 제품 이미지와 asset selection은 유지한다"는 요청
  // 사양과 배치된다).
  const showMedia = Boolean(image);
  const media =
    showMedia && image
      ? zoomLink(
          image,
          `<img src="${dataUri(image)}" alt="${escapeHtml(section.keyMessage)}" loading="lazy" ${assetDataAttrs(image, section.sectionId, design.layout)}>`,
        )
      : "";
  // 갤러리는 대표 사진의 표시 여부(showMedia)와 무관하게 내용이 있으면
  // 항상 보여준다(T1-147). T1-144 당시엔 갤러리가 96px 작은 썸네일이라
  // "대표 사진 없이 작은 사진들만" 남으면 어색했지만, 지금은 lifestyle
  // 이미지 밀도 요청에 맞춰 갤러리 자체가 180px 이상 큰 사진 행/그리드로
  // 커졌다 — 대표 사진이 Hero로 이미 쓰였어도(hideMedia) 갤러리에 담긴
  // 사진은 대표 사진과 다른 실제 사진이므로 그대로 보여주는 것이 이미지
  // 밀도·"제품 더보기 섹션 금지"(남은 이미지를 섹션 갤러리로 흡수하는
  // 대신 숨기지 않는다) 요청 사양에 맞다.
  const gallery =
    (item.gallery ?? []).length > 0
      ? galleryStrip(item.gallery ?? [], section.sectionId, design.layout, composition)
      : "";
  const aux = image ? "" : auxiliaryVisualLayer(auxiliaryVisual);
  const toneClass = design.toneIndex === 1 ? " pde-story-section--tone-b" : "";
  const layoutClass = `pde-story-section--${design.layout}`;
  const accentStyle = `--pde-story-accent:${design.accentColor};`;
  const wrapOpen = `<section class="pde-story-section ${layoutClass}${toneClass}" data-section-id="${escapeHtml(section.sectionId)}" data-section-index="${index}" data-layout="${design.layout}" data-icon="${design.icon}" style="${accentStyle}">${aux}`;
  const wrapClose = "</section>";

  switch (design.layout) {
    case "notice":
      return `${wrapOpen}
  <div class="pde-story-notice">
    ${kicker}
    <p class="pde-story-notice-label">${iconBadge(design, iconFamily)}확인해주세요</p>
    <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
    ${section.productFacts.length > 0 ? factList(section.productFacts, false) : ""}
  </div>
${wrapClose}`;

    case "spec-panel":
      return `${wrapOpen}
  <div class="pde-story-spec">
    ${kicker}
    <p class="pde-story-key-message">${iconBadge(design, iconFamily)}${escapeHtml(section.keyMessage)}</p>
    ${section.productFacts.length > 0 ? specFactGrid(section.productFacts) : ""}
    <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
  </div>
${wrapClose}`;

    case "step-by-step":
      return `${wrapOpen}
  ${kicker}
  <p class="pde-story-copy pde-story-copy--intro">${iconBadge(design, iconFamily)}${escapeHtml(section.copy)}</p>
  ${factList(section.productFacts, true)}
${wrapClose}`;

    case "feature-highlight":
      return `${wrapOpen}
  ${kicker}
  <p class="pde-story-key-message">${iconBadge(design, iconFamily)}${highlightHeadline(section.keyMessage)}</p>
  ${factList(section.productFacts, false)}
  <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
${wrapClose}`;

    case "problem-empathy":
      return `${wrapOpen}
  <blockquote class="pde-story-quote">
    <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
  </blockquote>
${wrapClose}`;

    case "detail-callout": {
      const figureClass = showMedia ? "pde-story-figure pde-story-figure--callout" : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>${kicker}<p class="pde-story-copy pde-story-copy--caption">${iconBadge(design, iconFamily)}${escapeHtml(section.copy)}</p></figcaption>
  </figure>
  ${gallery}
${wrapClose}`;
    }

    case "components-grid": {
      // T1-183이 계산만 해 두고 연결하지 않았던 composition.includedGrid를
      // 여기서 실제로 반영한다(T1-185) — "stacked"는 데스크톱에서도 좌우
      // 분할 grid를 적용하지 않는 별도 클래스라 사진이 전체 폭으로 위에,
      // 정보가 아래에 쌓인다. "info-left-image-right"는 기존 split 레이아웃
      // 그대로 유지한다(회귀 없음).
      const splitVariant =
        composition.includedGrid === "stacked" ? "pde-story-figure--stacked" : "pde-story-figure--split";
      const figureClass = showMedia ? `pde-story-figure ${splitVariant}` : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>
      ${kicker}
      <p class="pde-story-key-message">${iconBadge(design, iconFamily)}${escapeHtml(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
      ${section.productFacts.length > 0 ? componentsGrid(section.productFacts) : ""}
    </figcaption>
  </figure>
  ${gallery}
${wrapClose}`;
    }

    case "image-feature": {
      const figureClass = showMedia ? "pde-story-figure pde-story-figure--split" : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>
      ${kicker}
      <p class="pde-story-key-message">${iconBadge(design, iconFamily)}${highlightHeadline(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
      ${section.productFacts.length > 0 ? factList(section.productFacts, false) : ""}
    </figcaption>
  </figure>
  ${gallery}
${wrapClose}`;
    }

    case "image-text": {
      const figureClass = showMedia ? "pde-story-figure pde-story-figure--split" : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>
      <p class="pde-story-key-message">${iconBadge(design, iconFamily)}${escapeHtml(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
    </figcaption>
  </figure>
  ${gallery}
${wrapClose}`;
    }

    case "closing":
      return `${wrapOpen}
  <div class="pde-story-closing">
    ${showMedia ? `<div class="pde-story-closing-media">${media}</div>` : ""}
    <p class="pde-story-closing-message">${iconBadge(design, iconFamily)}${escapeHtml(section.keyMessage)}</p>
    <p class="pde-story-copy pde-story-copy--closing">${escapeHtml(section.copy)}</p>
  </div>
${wrapClose}`;

    case "text-only":
    default: {
      const figureClass = showMedia ? "pde-story-figure pde-story-figure--split" : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>
      <p class="pde-story-key-message">${iconBadge(design, iconFamily)}${escapeHtml(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
    </figcaption>
  </figure>
${wrapClose}`;
    }
  }
}

/**
 * Product Story를 하나의 `.pde-page` fragment로 렌더링한다.
 * T1-173 — HERO 블록을 제거했으므로 `narrativeSummary`가 페이지 맨 위에서
 * 시작하는 첫 카피가 된다(story-summary 밴드).
 */
export function renderProductStoryHtml(
  story: ProductStory,
  assignedSections: AssignedStorySection[],
  designPlan?: StoryDesignPlan,
  auxiliaryVisuals?: AuxiliaryVisualAsset[],
  generativeVisuals?: GenerativeVisualBundle,
  /**
   * Design Director(T1-176)가 만든 제품별 DESIGN_PROFILE — 지정하지
   * 않으면(undefined/null) 기존 baseline 그대로 렌더링한다(회귀 없음).
   * 유효성 검증은 호출자(`apps/api/src/product-profile/
   * product-profile.service.ts`)가 이미 마쳤다는 전제다 — 이 함수는 그
   * 결과를 신뢰하고 토큰만 소비한다(원시 CSS/HTML을 받지 않는다).
   */
  visualProfile?: ResolvedDesignProfile | null,
): ProductStoryHtmlResult {
  const plan = designPlan ?? planStoryDesign(story);
  // Master Art Direction Contract에서 파생된 HTML 디자인 토큰(T1-162,
  // T1-163에서 밝은 premium editorial 팔레트로 갱신) — 페이지 셸의
  // 유일한 값 출처. 순수 함수라 호출 비용이 없고, `product-story-facts-
  // panel.ts`도 같은 함수를 불러 항상 같은 값을 얻는다(단일 출처, 문서
  // 순서에 의존하는 CSS 변수 cascade가 아니라 각자 리터럴 값을 갖는다 —
  // 두 조각이 문서에서 어떤 순서로 합쳐지든 항상 같은 색이 나온다).
  // visualProfile이 있으면 그 tokens override만 얹는다(T1-176) — 없으면
  // 기존과 완전히 같은 baseline 값이다.
  const tokens = buildStoryVisualTokens(undefined, visualProfile?.tokens);
  // T1-183 — composition family가 없으면(캐시가 T1-183 이전에 만들어졌거나,
  // visualProfile 자체가 없는 기존 baseline 호출) 안전한 기본값
  // (editorial-brochure)으로 처리한다 — `resolveComposition`이 그 fallback을
  // 갖고 있다(design-profile.ts).
  const composition = visualProfile?.composition ?? resolveComposition(null);
  const alignClass = composition.headlineAlignment === "left" ? "pde-story-align-left" : "pde-story-align-center";
  const motifOpacity = visualProfile ? visualProfile.motif.opacity : 0.06;
  const motifBackgroundImage =
    visualProfile && visualProfile.motif.family !== "none"
      ? `${visualProfile.motif.backgroundImage.replace(/currentColor/g, `rgba(248, 250, 252, ${motifOpacity})`)}, linear-gradient(160deg, #0f172a 0%, #111c34 100%)`
      : visualProfile
        ? "linear-gradient(160deg, #0f172a 0%, #111c34 100%)"
        : "radial-gradient(rgba(248, 250, 252, 0.06) 1px, transparent 1px), linear-gradient(160deg, #0f172a 0%, #111c34 100%)";
  const designBySectionId = new Map(plan.sections.map((s) => [s.sectionId, s]));
  const auxiliaryBySectionId = new Map((auxiliaryVisuals ?? []).map((asset) => [asset.sectionId, asset]));
  // T1-177 — 아이콘 family는 DESIGN_PROFILE이 결정한다. profile이 없으면
  // 기존 baseline과 동일한 technical-outline을 쓴다(회귀 없음).
  // `generativeVisuals?.icons`(T1-142)는 더 이상 여기서 읽지 않는다 —
  // 렌더링은 항상 canonical registry만 쓴다(`iconBadge` 참고).
  const iconFamily: IconFamilyId = visualProfile?.icon.family ?? "technical-outline";
  const heroMotif = generativeVisuals?.heroMotif ?? null;
  // T1-173 — HERO 자체가 없어져 이 모티프는 이제 story-summary 구분선
  // 한 자리에만 쓰인다(예전에는 Hero 배경에도 재사용했다).
  const summaryMotifLayerHtml = heroMotif
    ? `<span class="pde-story-summary-motif" data-visual-source="gemini-generative-design" style="background-image:url('${generativeAssetDataUri(heroMotif)}')" aria-hidden="true"></span>`
    : "";

  // T1-173 — HERO 블록(짙은 배경 카드 + 중앙 제품 사진 패널 + 헤드라인/카피)을
  // 프로그램 렌더러에서 제거한다(사용자 명시 지시). 새 대체 비주얼을 만들지
  // 않고, 기존 HERO가 차지하던 자리를 그냥 비운다 — 아래 story-summary부터
  // 시작한다. HERO가 있던 시절에는 대표 이미지를 그 자리에 크게 보여주고
  // 원래 배정된 섹션 본문에서는 중복 표시를 생략했다(hideMedia) — HERO
  // 자체가 없어졌으니 그 사진은 이제 원래 배정된 섹션 본문에서 정상적으로
  // 보여준다(renderSection이 모든 섹션을 동일하게 처리한다).

  const sectionsHtml = assignedSections
    .map((item, index) => {
      const design = designBySectionId.get(item.section.sectionId) ?? {
        sectionId: item.section.sectionId,
        layout: "image-text" as const,
        reason: "design spec 없음 — 기본값",
        toneIndex: (index % 2) as 0 | 1,
        // "image-text" 레이아웃의 LAYOUT_VISUAL_TOKENS 값과 동일 —
        // design spec이 없을 때도 같은 레이아웃이면 같은 색·아이콘을 쓴다
        // (product-story-design.ts의 "레이아웃에서 결정적으로 도출한다" 원칙).
        accentColor: "#334155",
        icon: "none" as const,
        kicker: "",
      };
      return renderSection(
        item,
        index,
        design,
        auxiliaryBySectionId.get(item.section.sectionId),
        iconFamily,
        composition,
      );
    })
    .join("");

  // T1-182 — story-summary를 "제품명 + 핵심 메시지 + 서사 요약"의 editorial
  // hierarchy로 재구성한다(요청 사양 1 "제목/핵심 숫자/짧은 value
  // proposition의 hierarchy를 명확히 한다"). `story.masterBrief.coreMessage`는
  // Story Planner(T1-153)가 이미 만들어 저장해 두고도 지금까지 어떤
  // HTML에도 쓰이지 않던 실제 데이터다(지어내지 않음) — 없으면(구
  // fixture·masterBrief 미생성 경로) 조용히 생략한다.
  //
  // T1-183 — 위 T1-182 hierarchy에 "제품이 화면 주인공으로 크게 보이는
  // hero 사진 + feature icon row 4개"를 더한다(레퍼런스 요청 사양). T1-173이
  // 걱정했던 "본문 섹션과 사진 중복"은 여기서 재현되지 않는다 —
  // `selectHeroImage`가 고른 사진은 그 사진이 배정된 섹션에서도 여전히
  // 보여준다(레퍼런스 시안 자체가 hero와 본문 갤러리에 같은 계열의 제품
  // 사진을 반복해서 크게 쓰는 editorial-brochure 관행을 따른다) — 회귀
  // 테스트가 금지하는 것은 "HERO가 있던 시절의 hideMedia 중복 억제 로직"
  // 재도입이지, 사진 자체의 중복 등장이 아니다.
  const heroImage = selectHeroImage(assignedSections);
  const heroMediaHtml = heroImage
    ? `<div class="pde-story-hero-media" data-hero-aspect="${composition.hero.aspect}" style="--pde-hero-aspect:${frameAspectCss(composition.hero.aspect)};">${zoomLink(
        heroImage,
        `<img src="${dataUri(heroImage)}" alt="${escapeHtml(story.productName)}" ${assetDataAttrs(heroImage, "hero", "hero")}>`,
      )}</div>`
    : "";
  const heroFeatures: { icon: Exclude<StoryIconId, "none">; label: string }[] = [];
  for (const section of story.sections) {
    if (heroFeatures.length >= 4) break;
    const design = designBySectionId.get(section.sectionId);
    if (!design || design.icon === "none" || !section.keyMessage) continue;
    heroFeatures.push({ icon: design.icon, label: section.keyMessage });
  }
  const heroFeaturesHtml = heroImage ? heroFeatureListHtml(heroFeatures, iconFamily) : "";

  const summaryTagline = story.masterBrief?.coreMessage
    ? `<p class="pde-story-summary-tagline">${highlightHeadline(story.masterBrief.coreMessage)}</p>`
    : "";
  const summaryHtml = [
    `<div class="pde-story-summary ${alignClass}${heroImage ? " pde-story-summary--hero" : ""}">`,
    heroMediaHtml,
    summaryMotifLayerHtml,
    `<h1 class="pde-story-summary-name">${escapeHtml(story.productName)}</h1>`,
    summaryTagline,
    `<p class="pde-story-summary-narrative">${escapeHtml(story.narrativeSummary)}</p>`,
    heroFeaturesHtml,
    "</div>",
  ].join("");

  const html = [
    '<div class="pde-page pde-page--story">',
    summaryHtml,
    '<div class="pde-story-flow">',
    sectionsHtml,
    "</div>",
    "</div>",
  ].join("");

  const css = `
/* ============================================================
   Product Story — 밝은 premium editorial commerce 렌더러 (T1-126,
   다크 네이비 팔레트 T1-162 → 밝은 팔레트로 전환 T1-163: 화면이 너무
   어둡다는 판단에 따라 warm/cool off-white·white·very light blue-gray를
   주 배경으로 쓰고, navy는 타이포그래피·강조·closing 패널에만 제한한다.
   T1-164: 제품 사진 표시 영역을 확대(HERO 52%에서 58%로, split
   1.05fr에서 1.2fr로, letterbox padding 축소)하고, 헤드라인은 전체
   gradient 대신 마지막 핵심 어절만 강조하며, Hero feature 카드에
   "POINT 01/02" 라벨을 추가한다 — contain fit(잘림 없음)은 그대로
   유지한다.)
   원칙: 카드/얇은 테두리로 구획을 나누지 않는다. 섹션마다 배경 톤·큰
   비주얼·큰 타이포로 스크롤 리듬을 만든다. 자세한 배경은 이 파일 상단
   주석 참고. 모든 색·배경·테두리·반경·그림자 값은 ${tokens.tokensId}
   (buildStoryVisualTokens, product-composition-art-direction.ts)에서
   온다 — 이 파일이 임의로 색을 지어내지 않는다.
   ============================================================ */
.pde-page.pde-page--story {
  --pde-font-display: ${plan.typography.display};
  --pde-font-body: ${plan.typography.body};
  --pde-font-emphasis: ${plan.typography.emphasis};
  --pde-font-number: ${plan.typography.numeric};
  --pde-font-accent: ${plan.typography.accent};
  --pde-heading-weight: ${visualProfile?.typographyDetail.headingWeight ?? 700};
  --pde-heading-letter-spacing: ${visualProfile?.typographyDetail.letterSpacing ?? "-0.01em"};
  --pde-heading-line-height: ${visualProfile?.typographyDetail.lineHeight ?? "1.5"};
  --pde-bg-page: ${tokens.pageBackground};
  --pde-bg-surface-a: ${tokens.surfaceBackgroundA};
  --pde-bg-surface-b: ${tokens.surfaceBackgroundB};
  --pde-bg-panel: ${tokens.panelBackground};
  --pde-bg-image-frame: ${tokens.imageFrameBackground};
  --pde-border: ${tokens.borderColor};
  --pde-border-strong: ${tokens.borderColorStrong};
  --pde-text-primary: ${tokens.textPrimary};
  --pde-text-secondary: ${tokens.textSecondary};
  --pde-text-muted: ${tokens.textMuted};
  --pde-text-on-accent: ${tokens.textOnAccent};
  --pde-accent-gradient: ${tokens.accentGradient};
  --pde-accent-gradient-soft: ${tokens.accentGradientSoft};
  --pde-radius-sm: ${tokens.radiusSm};
  --pde-radius-md: ${tokens.radiusMd};
  --pde-radius-lg: ${tokens.radiusLg};
  --pde-radius-xl: ${tokens.radiusXl};
  --pde-shadow-card: ${tokens.shadowCard};
  --pde-shadow-glow: ${tokens.shadowGlow};
  --pde-icon-border: ${tokens.iconBadgeBorder};
  --pde-section-spacing: ${composition.sectionSpacingPx}px;
  --pde-text-measure: ${composition.maxTextMeasureCh}ch;
  max-width: 980px;
  margin: 0 auto;
  background: var(--pde-bg-page);
  font-family: var(--pde-font-body);
  color: var(--pde-text-primary);
  font-size: 17px;
  line-height: 1.7;
  word-break: keep-all;
  overflow: hidden;
  border-radius: var(--pde-radius-xl);
}

/* T1-173 — HERO 블록(header 및 그 하위 요소 전체)을 프로그램 렌더러에서
   제거했다(사용자 명시 지시). 그 마크업만 쓰던 CSS도 더 이상 어떤
   엘리먼트에도 매칭되지 않으므로 함께 지운다 — 죽은 CSS를 남겨 두지
   않는다. story-headline-accent(구 T1-164)만은 예외로 남긴다 —
   feature-highlight/image-feature 섹션의 헤드라인 강조가 지금도 이
   규칙을 그대로 쓴다(아래, HERO와 무관하게 계속 쓰이므로 T1-173 범위인
   "FEATURE 이하는 건드리지 않는다"에 따라 유지한다). */
.pde-page--story .pde-story-headline-accent {
  background: var(--pde-accent-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* -- 아이콘 배지: DESIGN_PROFILE.iconStyle.family가 고른 canonical SVG(T1-177) -- */
.pde-page--story .pde-story-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 10px;
  border-radius: 999px;
  border: 1px solid var(--pde-icon-border);
  color: var(--pde-story-accent, #94a3b8);
  background: color-mix(in srgb, var(--pde-story-accent, #94a3b8) 22%, var(--pde-bg-panel));
  vertical-align: -7px;
}

/* -- kicker 라벨: 레이아웃 의미를 나타내는 짧은 영문 accent 텍스트(이미지 아님, T1-142) --
   T1-163: eyebrow 번호(섹션의 실제 순서, 지어낸 값 아님)를 kicker 텍스트
   앞에 함께 보여준다 — "번호/eyebrow" editorial detail 요청 사양. -- */
.pde-page--story .pde-story-kicker {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  font-family: var(--pde-font-accent);
  font-size: 13px;
  font-weight: 700;
  font-style: italic;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--pde-story-accent, #334155);
}
.pde-page--story .pde-story-kicker-index {
  font-family: var(--pde-font-number);
  font-variant-numeric: tabular-nums;
  font-style: normal;
  opacity: 0.5;
}
.pde-page--story .pde-story-kicker-index::after {
  content: "";
  display: inline-block;
  width: 14px;
  height: 1px;
  margin-left: 10px;
  background: currentColor;
  opacity: 0.5;
  vertical-align: middle;
}
.pde-page--story .pde-story-section--spec-panel .pde-story-kicker,
.pde-page--story .pde-story-section--closing .pde-story-kicker {
  color: var(--pde-story-accent, #0369a1);
}
.pde-page--story .pde-story-section--closing .pde-story-kicker {
  color: rgba(248, 250, 252, 0.7);
}

/* -- Gemini 보조 그래픽: 실제 배경 비주얼로 쓴다(장식용 워터마크가 아니다) -- */
.pde-page--story .pde-story-aux-visual {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.4;
  pointer-events: none;
}
.pde-page--story .pde-story-aux-visual::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(5, 8, 16, 0.55), rgba(5, 8, 16, 0.88));
}

/* -- Story intro: 요약 문단이 아니라 큰 pull-quote 헤드라인처럼 -- */
.pde-page--story .pde-story-summary {
  position: relative;
  overflow: hidden;
  padding: 64px 24px;
  text-align: center;
  background: var(--pde-bg-surface-b);
}
/* T1-182 — 제목(productName)·핵심 메시지(masterBrief.coreMessage)·서사
   요약(narrativeSummary) 세 역할을 각각 다른 타이포 톤으로 분리한다
   (요청 사양 5 "heading/body/meta/numeric의 역할을 분리한다"). 제목이
   가장 크고 무겁고, 태그라인은 accent 강조가 실린 중간 크기, 서사
   요약은 보조 설명으로 가장 절제된 크기다. */
.pde-page--story .pde-story-summary-name {
  position: relative;
  z-index: 1;
  margin: 0 auto 14px;
  max-width: 22ch;
  font-family: var(--pde-font-display);
  font-size: clamp(28px, 6vw, 40px);
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--pde-text-primary);
}
.pde-page--story .pde-story-summary-tagline {
  position: relative;
  z-index: 1;
  margin: 0 auto 20px;
  max-width: 26ch;
  font-family: var(--pde-font-emphasis);
  font-size: clamp(18px, 3.6vw, 22px);
  font-weight: var(--pde-heading-weight);
  line-height: var(--pde-heading-line-height);
  letter-spacing: var(--pde-heading-letter-spacing);
  color: var(--pde-text-primary);
}
.pde-page--story .pde-story-summary-narrative {
  position: relative;
  z-index: 1;
  margin: 0 auto;
  max-width: 34ch;
  font-family: var(--pde-font-body);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.7;
  color: var(--pde-text-secondary);
  white-space: pre-wrap;
}
/* Hero와 같은 생성형 모티프 자산을 재사용하는 구분선 액센트(T1-142 — "재사용 가능한 디자인 토큰") */
.pde-page--story .pde-story-summary-motif {
  position: absolute;
  inset: -20% -10%;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  opacity: 0.12;
  pointer-events: none;
  z-index: 0;
}

/* -- T1-183 헤드라인 정렬 유틸: composition.headlineAlignment(editorial
   left 중심, 레퍼런스 사양 "한국어 heading 과도한 중앙정렬 금지")를 클래스로
   적용한다. -pde-story-summary-name/tagline/narrative는 기본이
   margin:0 auto(중앙)라 left일 때는 margin을 0으로 되돌린다. -- */
.pde-page--story .pde-story-summary.pde-story-align-left {
  text-align: left;
}
.pde-page--story .pde-story-summary.pde-story-align-left .pde-story-summary-name,
.pde-page--story .pde-story-summary.pde-story-align-left .pde-story-summary-tagline,
.pde-page--story .pde-story-summary.pde-story-align-left .pde-story-summary-narrative {
  margin-left: 0;
  margin-right: 0;
  max-width: var(--pde-text-measure, 34ch);
}

/* -- T1-183 hero: 페이지 최상단에 실제 검증된 제품 사진을 크게 보여준다
   (근본 원인: T1-173이 이 블록 자체를 제거했었다 — 이번 요청 사양은 다시
   요구한다). navy 블록/도트 그리드가 아니라 story-summary와 같은 밝은
   surface를 그대로 쓴다("Hero는 navy 블록/도트 그리드 아님" 요청 사양).
   종횡비는 canonical image frame registry(composition.hero.aspect,
   16:9/4:3)에서만 오고, object-fit:contain이라 실제 asset을 crop하지
   않는다. -- */
.pde-page--story .pde-story-summary--hero {
  padding-top: 32px;
  padding-bottom: 56px;
}
.pde-page--story .pde-story-hero-media {
  position: relative;
  z-index: 1;
  aspect-ratio: var(--pde-hero-aspect, 4 / 3);
  margin: 0 0 32px;
  border-radius: var(--pde-radius-lg);
  overflow: hidden;
  background: var(--pde-bg-image-frame);
}
.pde-page--story .pde-story-hero-media > a {
  display: block;
  width: 100%;
  height: 100%;
}
.pde-page--story .pde-story-hero-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
/* feature icon row 4개 — pill/배지 배경 없이 아이콘+짧은 텍스트만
   (레퍼런스 사양 "pill 남발 금지"), 모바일 2x2. */
.pde-page--story .pde-story-hero-features {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px 20px;
  margin: 28px 0 0;
  padding: 24px 0 0;
  list-style: none;
  border-top: 1px solid var(--pde-border);
  text-align: left;
}
.pde-page--story .pde-story-hero-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pde-page--story .pde-story-hero-feature .pde-story-icon {
  flex: none;
  margin-right: 0;
}
.pde-page--story .pde-story-hero-feature-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--pde-text-secondary);
}

.pde-page--story .pde-story-flow {
  display: flex;
  flex-direction: column;
}

/* -- 섹션: 배경 색 블록(surface A/B 교차)으로 큰 리듬을 만들고, 그 위에
   얇은 그래픽 divider 하나로 섹션 경계를 정리한다(T1-163 "섹션 사이에
   얇은 그래픽 divider" 요청 사양) — 두꺼운 카드 테두리가 아니라 폭
   전체가 아닌 중앙 hairline이라 절제된 editorial 톤을 유지한다. -- */
.pde-page--story .pde-story-section {
  position: relative;
  /* T1-183 — composition.sectionSpacingPx(72/96/120, editorial-brochure는
     120=spacious)로 섹션 세로 리듬을 결정한다(레퍼런스 사양 "72~120px"). */
  padding: var(--pde-section-spacing, 56px) 24px;
}
.pde-page--story .pde-story-section:not(:first-of-type)::before {
  content: "";
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--pde-border-strong) 50%, transparent);
}
.pde-page--story .pde-story-section:last-child {
  padding-bottom: 80px;
}
.pde-page--story .pde-story-section--tone-b {
  background: var(--pde-bg-surface-b);
}

/* -- 공통 figure/이미지: 둥근 대형 container(레퍼런스 시안 요청 사양) —
   T1-126 당시엔 edge-to-edge full-bleed였으나, 프레임 없는 cover crop이
   제품 본체를 잘라내는 문제가 있어(T1-162 완료 기준) contain +
   letterbox 프레임 + 둥근 모서리 카드로 바꾼다. -- */
.pde-page--story .pde-story-figure {
  margin: 0;
}
.pde-page--story .pde-story-figure > a {
  display: block;
}
/* T1-165 — 이미지 자체의 내부 padding(매트 프레임)과 고정
   min-height를 없앤다. height:auto라 컨테이너가 이미지의 실제 비율을
   그대로 따라가므로, contain fit이 만드는 letterbox 여백이 거의 생기지
   않는다(요청 사양 4 — "컨테이너 자체를 이미지 비율에 맞춰 동적으로
   계산"). max-height는 극단적으로 세로가 긴 사진에 대한 안전장치일 뿐. */
/* T1-182 — 사진 자체 테두리+프레임 배경을 없앤다. 섹션 padding이 이미
   하나의 프레임 역할을 하는데, 사진에 다시 테두리+배경을 두르면
   "이중 프레임"이 된다(요청 사양 4). object-fit:contain + height:auto라
   letterbox 여백 자체가 거의 생기지 않으므로 프레임 배경은 실제로 거의
   보이지 않던 값이었다 — 지우는 것이 회귀가 아니다. 둥근 모서리만
   사진 자체에 남겨 절제된 premium 톤을 유지한다. */
.pde-page--story .pde-story-figure img {
  display: block;
  width: 100%;
  height: auto;
  margin: 0 0 28px;
  max-width: none;
  max-height: 70vh;
  object-fit: contain;
  border-radius: var(--pde-radius-md);
  box-sizing: border-box;
}
/* T1-182 — HERO를 대신해 첫 섹션의 실제 사진을 오프닝 비주얼로 더 크게
   보여준다(요청 사양 1 "제품 사진은 충분히 크게"). 마크업·섹션 순서는
   그대로다 — 데스크톱 전용 CSS 비중 조정뿐이다. 첫 섹션이 split
   레이아웃이 아니면(예: feature-highlight) 이 선택자는 아무 것도
   바꾸지 않는다. */
.pde-page--story .pde-story-flow > .pde-story-section:first-of-type .pde-story-figure img {
  max-height: 76vh;
}
.pde-page--story .pde-story-figure--text-only {
  max-width: 46ch;
}
.pde-page--story .pde-story-copy {
  margin: 0;
  max-width: 38ch;
  font-size: 17px;
  font-weight: 500;
  line-height: 1.8;
  color: var(--pde-text-secondary);
  white-space: pre-wrap;
}
.pde-page--story .pde-story-key-message {
  margin: 0 0 14px;
  font-family: var(--pde-font-emphasis);
  font-size: clamp(24px, 5.5vw, 32px);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--pde-text-primary);
  max-width: 20ch;
}
/* -- FEATURE 섹션 헤드라인 — kicker(FEATURE) + 강한 headline + 핵심
   어절만 gradient text 조합(T1-162 요청 사양, T1-164에서 전체 텍스트
   gradient를 마지막 어절만 강조하도록 조정 — pde-story-headline-accent
   span이 실제 강조를 담당하므로 이 선택자는 더 이상 필요 없다). -- */

/* -- split layout: 이미지와 카피를 데스크톱에서 좌우로 교차 배치(image-feature/image-text/text-only) -- */
.pde-page--story .pde-story-figure--split figcaption {
  display: block;
}

/* -- stacked layout(composition.includedGrid="stacked", T1-183/T1-185): 데스크톱 split
   grid를 적용하지 않는다 — 사진이 전체 폭으로 위에, 정보가 아래에 쌓인 채로
   유지된다(components-grid 레이아웃 전용). 텍스트 폭은 composition마다
   달라지는 --pde-text-measure를 그대로 따른다. */
.pde-page--story .pde-story-figure--stacked figcaption {
  display: block;
  max-width: var(--pde-text-measure, 44ch);
  margin: 0 auto;
}

/* -- feature-highlight: 근거를 3/4-card 비주얼 그리드로 -- */
.pde-page--story .pde-story-section--feature-highlight .pde-story-key-message {
  max-width: none;
}
.pde-page--story .pde-story-section--feature-highlight .pde-story-facts {
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.pde-page--story .pde-story-section--feature-highlight .pde-story-facts li {
  background: var(--pde-story-accent, #0f766e);
  color: var(--pde-text-on-accent);
  font-family: var(--pde-font-emphasis);
  font-size: 17px;
  font-weight: 800;
  line-height: 1.35;
  padding: 24px 18px;
  border-radius: var(--pde-radius-md);
}

/* -- step-by-step: 카드가 아니라 번호+연결선으로 이어지는 시퀀스 다이어그램 -- */
.pde-page--story .pde-story-copy--intro {
  max-width: 42ch;
  margin-bottom: 24px;
}
.pde-page--story .pde-story-section--step-by-step .pde-story-facts {
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
  counter-reset: pde-step;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.pde-page--story .pde-story-section--step-by-step .pde-story-facts li {
  counter-increment: pde-step;
  position: relative;
  padding: 0 0 0 56px;
  min-height: 40px;
  display: flex;
  align-items: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--pde-text-primary);
}
.pde-page--story .pde-story-section--step-by-step .pde-story-facts li::before {
  content: counter(pde-step);
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--pde-story-accent, #4338ca);
  color: var(--pde-text-on-accent);
  font-family: var(--pde-font-number);
  font-variant-numeric: tabular-nums;
  font-size: 16px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}
.pde-page--story .pde-story-section--step-by-step .pde-story-facts li:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 19px;
  top: 44px;
  bottom: -28px;
  width: 2px;
  background: color-mix(in srgb, var(--pde-story-accent, #4338ca) 40%, transparent);
}

/* -- spec-panel: 밝은 오프화이트 패널 위에 큰 숫자 + 짧은 라벨 그리드.
   절제된 대각선 hairline 모티프를 함께 깔아 "subtle grid/noise/line
   motif" editorial detail 요청을 만족한다(T1-163) — 값을 가리지 않도록
   아주 낮은 불투명도. -- */
.pde-page--story .pde-story-section--spec-panel {
  background-color: var(--pde-bg-panel);
  background-image: repeating-linear-gradient(
    135deg,
    rgba(15, 23, 42, 0.035) 0px,
    rgba(15, 23, 42, 0.035) 1px,
    transparent 1px,
    transparent 28px
  );
  color: var(--pde-text-primary);
}
.pde-page--story .pde-story-section--spec-panel .pde-story-key-message {
  color: var(--pde-text-primary);
  max-width: none;
}
.pde-page--story .pde-story-section--spec-panel .pde-story-copy {
  color: var(--pde-text-secondary);
}
.pde-page--story .pde-story-spec-grid {
  margin: 28px 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 28px 16px;
}
.pde-page--story .pde-story-spec-value {
  display: block;
  font-family: var(--pde-font-number);
  font-variant-numeric: tabular-nums;
  font-size: clamp(28px, 7vw, 42px);
  font-weight: 800;
  color: var(--pde-story-accent, #38bdf8);
  line-height: 1.1;
}
/* 값이 길면(구성품명 등 숫자가 아닌 문구) 절제된 크기로 — 큰 숫자 강조는
   실제로 짧은 수치·단어에만 쓴다 */
.pde-page--story .pde-story-spec-value--long {
  font-family: var(--pde-font-emphasis);
  font-size: clamp(17px, 3vw, 20px);
  font-weight: 700;
  line-height: 1.4;
}
.pde-page--story .pde-story-spec-label {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--pde-text-muted);
  letter-spacing: 0.02em;
}

/* -- notice: 흰 카드 + 좌측 amber 컬러 바의 확인 안내 밴드 (T1-163: 밝은 배경 위에서도 대비가 살도록 진한 amber 사용) -- */
.pde-page--story .pde-story-section--notice .pde-story-notice {
  background: var(--pde-bg-panel);
  border: 1px solid var(--pde-border);
  border-left: 6px solid var(--pde-story-accent, #92400e);
  border-radius: var(--pde-radius-md);
  padding: 24px 24px 24px 22px;
}
.pde-page--story .pde-story-notice-label {
  margin: 0 0 10px;
  font-family: var(--pde-font-emphasis);
  font-size: 14px;
  font-weight: 800;
  color: var(--pde-story-accent, #92400e);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pde-page--story .pde-story-section--notice .pde-story-copy {
  max-width: 42ch;
  font-size: 18px;
  font-weight: 600;
  color: var(--pde-text-primary);
}
.pde-page--story .pde-story-section--notice .pde-story-facts {
  margin: 16px 0 0;
  padding-left: 20px;
  font-size: 15px;
  color: var(--pde-text-secondary);
}

/* -- problem-empathy: 큰 스테이트먼트형 헤드카피, 인용부호 대신 굵은 타이포로 -- */
.pde-page--story .pde-story-section--problem-empathy {
  text-align: center;
}
.pde-page--story .pde-story-quote {
  margin: 0 auto;
  max-width: 30ch;
  padding: 0;
  border-left: none;
}
.pde-page--story .pde-story-quote .pde-story-copy {
  max-width: none;
  font-family: var(--pde-font-display);
  font-size: clamp(22px, 6vw, 30px);
  font-weight: 700;
  font-style: normal;
  line-height: 1.4;
  color: var(--pde-text-primary);
  letter-spacing: -0.01em;
}

/* -- image-feature: 근거를 outline chip으로 — feature-highlight의 채워진
   카드(solid fill)와 accent treatment를 다르게 가져가 "섹션마다 동일한
   pill만 반복하지 않는다"는 요청 사양을 만족한다(T1-163). 옅은 accent
   틴트 배경 + accent 테두리/텍스트로, 밝은 페이지 배경 위에서 절제된
   느낌을 유지한다. -- */
.pde-page--story .pde-story-section--image-feature .pde-story-facts {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.pde-page--story .pde-story-section--image-feature .pde-story-facts li {
  border: 1px solid color-mix(in srgb, var(--pde-story-accent, #0f766e) 45%, transparent);
  color: var(--pde-story-accent, #0f766e);
  background: color-mix(in srgb, var(--pde-story-accent, #0f766e) 10%, var(--pde-bg-panel));
  font-size: 14px;
  font-weight: 700;
  padding: 9px 18px;
  border-radius: 999px;
}

/* -- components-grid: 구성품을 카드형 그리드로 나열 (T1-138) — image-feature의 필(pill) 나열과 달리 번호 카드로 "몇 개가 들어있는지"를 한 눈에 센다 -- */
.pde-page--story .pde-story-components-grid {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
/* T1-182 — box-shadow 제거(요청 사양 6 "heavy shadow 제거"), 절제된
   테두리 하나로만 카드 경계를 표시한다. */
.pde-page--story .pde-story-components-grid li {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--pde-bg-panel);
  border: 1px solid var(--pde-border);
  border-radius: var(--pde-radius-md);
  padding: 16px;
}
.pde-page--story .pde-story-components-index {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--pde-story-accent, #6d28d9);
  color: var(--pde-text-on-accent);
  font-family: var(--pde-font-number);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 800;
}
.pde-page--story .pde-story-components-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--pde-text-primary);
  line-height: 1.4;
}

/* -- detail-callout: 클로즈업 사진을 full-bleed로, 캡션은 이미지 위 오버레이로 -- */
.pde-page--story .pde-story-figure--callout {
  position: relative;
}
.pde-page--story .pde-story-figure--callout img {
  max-height: 560px;
}
/* -- 캡션은 더 이상 이미지 위 오버레이가 아니다(T1-162) — contain 프레임
   이미지는 letterbox 여백이 생겨, 그 위에 그라디언트 오버레이 텍스트를
   얹으면 여백 위에 붕 떠 보인다. 프레임 아래 다크 패널로 붙여 같은
   정보 밀도를 유지하면서 "안전 crop" 요구와 충돌하지 않게 한다. -- */
.pde-page--story .pde-story-figure--callout figcaption {
  padding: 24px 4px 0;
}
.pde-page--story .pde-story-copy--caption {
  margin: 0;
  max-width: none;
  font-size: 19px;
  font-weight: 700;
  color: var(--pde-text-primary);
}

/* -- closing: 캠페인 사인오프 — 페이지 전체는 밝지만(T1-163), closing만은
   요청 사양이 명시적으로 허용한 "일부 feature panel"의 제한된 navy
   사용처다 — 페이지가 끝나는 지점에 확실히 다른 무게감을 준다. 이 안의
   색은 페이지 공용 밝은 토큰(--pde-text-primary 등)을 쓰지 않고 이
   패널 전용 값을 직접 갖는다(밝은 텍스트가 밝은 토큰과 이름이 겹치면
   안 되므로 리터럴로 분리). 낮은 불투명도 dot-grid 모티프를 더해
   "subtle grid/noise/line motif" 요청 사양을 여기서도 만족한다. -- */
.pde-page--story .pde-story-section--closing {
  text-align: center;
  padding: 96px 24px 112px;
  background-color: #0f172a;
  background-image: ${motifBackgroundImage};
  background-size: 18px 18px, auto;
  color: #f8fafc;
}
.pde-page--story .pde-story-closing-media img {
  max-height: 460px;
}
.pde-page--story .pde-story-closing-message {
  margin: 0 auto 16px;
  max-width: 20ch;
  font-family: var(--pde-font-display);
  font-size: clamp(28px, 7vw, 44px);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: #f8fafc;
  background: linear-gradient(120deg, #5eead4 0%, #38bdf8 55%, #818cf8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.pde-page--story .pde-story-copy--closing {
  max-width: 42ch;
  margin: 0 auto;
  color: rgba(248, 250, 252, 0.72);
  font-size: 17px;
}

/* -- 갤러리 스트립: 대표 이미지 하나로는 부족한 섹션(구성품·디테일·사용
   장면 여러 컷)에 붙는 lifestyle 이미지 행(T1-144 최초 도입, T1-147에서
   확대). T1-183 — 셀마다 auto-height로 제각각 크기이던 것(T1-165)을,
   composition의 canonical gallery 종횡비/열 수(css변수 pde-gallery-cell-aspect
   / pde-gallery-columns, galleryStrip()이 인라인 style로 주입)로
   통일한다(요청 사양 "모든 이미지가 동일한 canonical cell geometry를
   따르도록, 이미지별 독립 auto-height 금지"). object-fit:contain은 그대로
   유지해 실제 asset을 crop하지 않는다 — 셀 "박스"만 통일한다. -- */
.pde-page--story .pde-story-gallery-strip {
  display: grid;
  grid-template-columns: repeat(var(--pde-gallery-columns, 2), 1fr);
  gap: 10px;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}
.pde-page--story .pde-story-gallery-strip li {
  position: relative;
  aspect-ratio: var(--pde-gallery-cell-aspect, 4 / 3);
  overflow: hidden;
  border-radius: var(--pde-radius-sm);
  background: var(--pde-bg-image-frame);
  box-sizing: border-box;
}
.pde-page--story .pde-story-gallery-strip li > a {
  display: block;
  width: 100%;
  height: 100%;
}
.pde-page--story .pde-story-gallery-strip img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  box-sizing: border-box;
}

@media (min-width: 760px) {
  .pde-page.pde-page--story {
    font-size: 18px;
  }
  .pde-page--story .pde-story-section {
    padding: var(--pde-section-spacing, 96px) 64px;
  }
  .pde-page--story .pde-story-section:last-child {
    padding-bottom: 128px;
  }
  .pde-page--story .pde-story-summary {
    padding: 88px 64px;
  }
  .pde-page--story .pde-story-summary--hero {
    padding-top: 56px;
  }
  .pde-page--story .pde-story-hero-media {
    max-width: 640px;
    margin-left: auto;
    margin-right: auto;
  }
  .pde-page--story .pde-story-summary.pde-story-align-left .pde-story-hero-media {
    margin-left: 0;
  }
  .pde-page--story .pde-story-hero-features {
    grid-template-columns: repeat(4, 1fr);
  }
  .pde-page--story .pde-story-gallery-strip {
    grid-template-columns: repeat(var(--pde-gallery-columns, 3), 1fr);
  }
  .pde-page--story .pde-story-figure img {
    width: 100%;
    margin: 0 0 32px;
    max-height: 640px;
  }
  /* split layout: 이미지 좌/우 교차 배치, negative-margin bleed는 grid column 안에서는 해제.
     T1-165 — min-height를 없애 height:auto가 이미지 실제 비율을 그대로
     따르게 한다(align-items:center는 그대로 유지 — 이미지 컬럼이 텍스트
     컬럼 높이에 억지로 늘어나지 않는다). */
  .pde-page--story .pde-story-figure--split {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 48px;
    align-items: center;
  }
  .pde-page--story .pde-story-figure--split img {
    width: 100%;
    margin: 0;
    max-height: 620px;
  }
  /* T1-182 — 오프닝 구성: 첫 섹션만 이미지 비중을 더 키운다(요청 사양 1). */
  .pde-page--story .pde-story-flow > .pde-story-section:first-of-type .pde-story-figure--split {
    grid-template-columns: 1.4fr 1fr;
  }
  .pde-page--story .pde-story-flow > .pde-story-section:first-of-type .pde-story-figure--split img {
    max-height: 720px;
  }
  .pde-page--story .pde-story-section--tone-b .pde-story-figure--split {
    direction: rtl;
  }
  .pde-page--story .pde-story-section--tone-b .pde-story-figure--split > * {
    direction: ltr;
  }
  .pde-page--story .pde-story-key-message {
    font-size: clamp(28px, 3.4vw, 38px);
  }
  .pde-page--story .pde-story-section--feature-highlight .pde-story-facts {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
  .pde-page--story .pde-story-spec-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .pde-page--story .pde-story-components-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
}
`.trim();

  // DESIGN_PROFILE의 iconStyle(T1-176) — 아이콘 registry의 path data는
  // 그대로 두고 stroke-width/corner/size 속성만 치환한다. profile이 없으면
  // 아무것도 바뀌지 않는다(기존 baseline 그대로).
  const finalHtml = visualProfile ? applyIconStyleToHtml(html, visualProfile.icon) : html;

  return { html: finalHtml, css };
}
