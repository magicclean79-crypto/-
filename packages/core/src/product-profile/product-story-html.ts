import type { ProductStory } from "./product-story";
import type { AssignedStorySection, LeftoverGalleryEntry } from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";
import { planStoryDesign, type SectionDesignSpec, type StoryDesignPlan } from "./product-story-design";
import { iconMarkup, type StoryIconId } from "./product-page-icons";
import type { AuxiliaryVisualAsset } from "./product-story-auxiliary-visual";
import type { GenerativeVisualAsset } from "./product-story-generative-visuals";

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
 * - **생성형 아이콘/Hero 모티프**(`generativeVisuals`, 선택적, T1-142):
 *   `product-story-generative-visuals.ts`가 계획하고 Gemini가 실제로
 *   만든 아이콘/모티프 자산. 있으면 기존 인라인 SVG 아이콘·순수 CSS
 *   배경 대신 이 생성형 자산을 쓴다 — **없으면(생성 실패·imageGen 미연결
 *   등) 기존 SVG/CSS로 graceful하게 되돌아간다**(요청 사양 그대로 —
 *   생성형 자산은 향상이지 필수 의존성이 아니다). `data-icon-source`로
 *   생성형/기본 아이콘을 DOM에서 구분한다.
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
  return (
    `data-asset-id="${escapeHtml(image.imageId)}" data-asset-category="${escapeHtml(image.category)}" ` +
    `data-asset-source="${source}" data-asset-section-id="${escapeHtml(sectionId)}" ` +
    `data-asset-purpose="${escapeHtml(purpose)}" data-asset-version="${image.groupVersion ?? ""}"`
  );
}

/**
 * 대표 이미지 외에 같은 섹션에 함께 붙는 추가 사진들 — 구성품 전부·디테일
 * 여러 컷처럼 "한 장으로는 부족한" 카테고리에서 쓴다(T1-144). 대표 이미지와
 * 같은 zoom 링크·asset 속성을 갖되, 더 작은 썸네일 그리드로 렌더링된다.
 */
function galleryStrip(images: StudioSelectedImage[], sectionId: string, purpose: string): string {
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
  return `<ul class="pde-story-gallery-strip" data-gallery-count="${images.length}">${items}</ul>`;
}

export interface ProductStoryHtmlResult {
  html: string;
  css: string;
}

/** 생성형 아이콘/Hero 모티프 자산을 렌더러가 쓰기 좋은 형태로 묶은 것 (T1-142) */
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
 * 아이콘 없음, T1-112). 생성형 아이콘 자산이 있으면 그것을(`<img>`), 없으면
 * 기존 인라인 SVG를 쓴다(T1-142 graceful fallback — 생성 실패가 섹션 전체를
 * 막지 않는다).
 */
function iconBadge(design: SectionDesignSpec, generativeIcons: Partial<Record<StoryIconId, GenerativeVisualAsset>>): string {
  if (design.icon === "none") return "";
  const generated = generativeIcons[design.icon];
  if (generated) {
    return `<span class="pde-story-icon pde-story-icon--gen" data-icon-source="gemini-generative-design" aria-hidden="true"><img src="${generativeAssetDataUri(generated)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="pde-story-icon" data-icon-source="fallback-svg" aria-hidden="true">${iconMarkup(design.icon)}</span>`;
}

/** 레이아웃 의미를 나타내는 짧은 영문 kicker 라벨(accent 폰트, 순수 텍스트) — 빈 문자열이면 아무것도 그리지 않는다(T1-142) */
function kickerLabel(design: SectionDesignSpec): string {
  if (!design.kicker) return "";
  return `<span class="pde-story-kicker">${escapeHtml(design.kicker)}</span>`;
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
  hideMedia: boolean,
  generativeIcons: Partial<Record<StoryIconId, GenerativeVisualAsset>>,
): string {
  const { section, image } = item;
  const kicker = kickerLabel(design);
  // `image`는 이 섹션에 실제로 배정된 사진(있는지 여부)을 나타낸다 —
  // 보조 그래픽 억제(aux)는 이 값을 기준으로 판단해야 한다("실제 제품
  // 사진이 있는 섹션에는 보조 그래픽을 그리지 않는다"). `hideMedia`는
  // 그 사진이 Hero로 이미 쓰여 본문에서만 중복 표시를 생략하는
  // 별개의 렌더링 결정이다 — 이 둘을 섞으면 Hero로 쓰인 섹션에
  // 실제 사진이 있는데도 보조 그래픽이 잘못 그려진다(T1-118 실측
  // 회귀: 두 값을 하나의 `image: null`로 합쳤다가 발견).
  const showMedia = Boolean(image) && !hideMedia;
  const media =
    showMedia && image
      ? zoomLink(
          image,
          `<img src="${dataUri(image)}" alt="${escapeHtml(section.keyMessage)}" loading="lazy" ${assetDataAttrs(image, section.sectionId, design.layout)}>`,
        )
      : "";
  // 대표 이미지가 실제로 화면에 보일 때만 갤러리도 함께 보여준다(T1-144) —
  // hideMedia로 대표 사진 자체를 생략한 섹션(Hero 중복 방지)에 갤러리만
  // 남으면 "왜 이 섹션엔 큰 사진이 없는데 작은 사진들만 있지"처럼 어색하다.
  const gallery = showMedia ? galleryStrip(item.gallery ?? [], section.sectionId, design.layout) : "";
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
    <p class="pde-story-notice-label">${iconBadge(design, generativeIcons)}확인해주세요</p>
    <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
    ${section.productFacts.length > 0 ? factList(section.productFacts, false) : ""}
  </div>
${wrapClose}`;

    case "spec-panel":
      return `${wrapOpen}
  <div class="pde-story-spec">
    ${kicker}
    <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
    ${section.productFacts.length > 0 ? specFactGrid(section.productFacts) : ""}
    <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
  </div>
${wrapClose}`;

    case "step-by-step":
      return `${wrapOpen}
  ${kicker}
  <p class="pde-story-copy pde-story-copy--intro">${iconBadge(design, generativeIcons)}${escapeHtml(section.copy)}</p>
  ${factList(section.productFacts, true)}
${wrapClose}`;

    case "feature-highlight":
      return `${wrapOpen}
  ${kicker}
  <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
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
    <figcaption>${kicker}<p class="pde-story-copy pde-story-copy--caption">${iconBadge(design, generativeIcons)}${escapeHtml(section.copy)}</p></figcaption>
  </figure>
  ${gallery}
${wrapClose}`;
    }

    case "components-grid": {
      const figureClass = showMedia ? "pde-story-figure pde-story-figure--split" : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>
      ${kicker}
      <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
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
      <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
      ${section.productFacts.length > 0 ? factList(section.productFacts, false) : ""}
    </figcaption>
  </figure>
${wrapClose}`;
    }

    case "image-text": {
      const figureClass = showMedia ? "pde-story-figure pde-story-figure--split" : "pde-story-figure pde-story-figure--text-only";
      return `${wrapOpen}
  <figure class="${figureClass}">
    ${media}
    <figcaption>
      <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
    </figcaption>
  </figure>
${wrapClose}`;
    }

    case "closing":
      return `${wrapOpen}
  <div class="pde-story-closing">
    ${showMedia ? `<div class="pde-story-closing-media">${media}</div>` : ""}
    <p class="pde-story-closing-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
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
      <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
      <p class="pde-story-copy">${escapeHtml(section.copy)}</p>
    </figcaption>
  </figure>
${wrapClose}`;
    }
  }
}

const GALLERY_SOURCE_LABEL: Record<"real" | "generated", string> = {
  real: "실제 제품 사진",
  generated: "AI 생성 연출",
};

/**
 * 어느 Story Section에도 배정되지 못하고 남은 선택 이미지를 상세페이지
 * 맨 아래 "제품 더 보기" 구획으로 보여준다(T1-144 — 이미지 밀도 확대,
 * `buildLeftoverMediaGallery` 참고). Story Section 레이아웃과는 별개의
 * 새 레이아웃이다 — 카피 없이 사진만 촘촘히 보여주는 것이 목적이라
 * 억지로 "섹션"인 척 카피를 지어내지 않는다.
 */
function renderMediaGallerySection(entries: LeftoverGalleryEntry[]): string {
  if (entries.length === 0) return "";
  const items = entries
    .map(({ image }) => {
      const source = image.source ?? "generated";
      return `<li>${zoomLink(
        image,
        `<img src="${dataUri(image)}" alt="" loading="lazy" ${assetDataAttrs(image, "media-gallery", "gallery")}>` +
          `<span class="pde-media-gallery-badge" data-asset-source="${source}">${GALLERY_SOURCE_LABEL[source]}</span>`,
      )}</li>`;
    })
    .join("");
  return `<section class="pde-media-gallery" data-section-id="media-gallery" data-layout="media-gallery">
  <p class="pde-media-gallery-heading">제품 더 보기</p>
  <ul class="pde-media-gallery-grid" data-gallery-count="${entries.length}">${items}</ul>
</section>`;
}

/**
 * Product Story를 하나의 `.pde-page` fragment로 렌더링한다.
 * `productName`은 Hero 타이틀에, `narrativeSummary`는 부제(headline
 * 자리)로 쓴다 — 기존 렌더러의 Hero 개념과 자리를 맞춰 다른 템플릿과
 * 섞여도 위화감이 없게 한다.
 */
export function renderProductStoryHtml(
  story: ProductStory,
  assignedSections: AssignedStorySection[],
  designPlan?: StoryDesignPlan,
  auxiliaryVisuals?: AuxiliaryVisualAsset[],
  generativeVisuals?: GenerativeVisualBundle,
  mediaGallery?: LeftoverGalleryEntry[],
): ProductStoryHtmlResult {
  const plan = designPlan ?? planStoryDesign(story);
  const designBySectionId = new Map(plan.sections.map((s) => [s.sectionId, s]));
  const auxiliaryBySectionId = new Map((auxiliaryVisuals ?? []).map((asset) => [asset.sectionId, asset]));
  const generativeIcons = generativeVisuals?.icons ?? {};
  const heroMotif = generativeVisuals?.heroMotif ?? null;
  // Hero 모티프(있으면)는 요청 사양 2 "재사용 가능한 디자인 토큰"에 따라
  // Hero 배경 뒤 + Story 요약 밴드 구분선, 두 자리에 같은 자산을 재사용한다
  // — 새 자산을 더 만들지 않고 하나를 여러 곳에 쓴다.
  const heroMotifLayerHtml = heroMotif
    ? `<span class="pde-hero-motif" data-visual-source="gemini-generative-design" style="background-image:url('${generativeAssetDataUri(heroMotif)}')" aria-hidden="true"></span>`
    : "";
  const summaryMotifLayerHtml = heroMotif
    ? `<span class="pde-story-summary-motif" data-visual-source="gemini-generative-design" style="background-image:url('${generativeAssetDataUri(heroMotif)}')" aria-hidden="true"></span>`
    : "";

  const heroSourceItem = assignedSections.find((item) => item.image) ?? null;
  const heroImage = heroSourceItem?.image ?? null;
  // Hero 서브헤드라인 — 첫 섹션의 keyMessage(짧은 카피 헤드라인, T1-126 프롬프트
  // 개정으로 짧아짐)를 그대로 쓴다. narrativeSummary는 문단 요약이라 Hero에
  // 쓰면 다시 "설명문"이 되므로 쓰지 않고, 아래 story-summary 밴드에 별도로
  // 한 번만 표시한다(중복 노출 금지).
  const heroSubheadline = assignedSections[0]?.section.keyMessage.trim() ?? "";
  const heroSubheadlineHtml = heroSubheadline
    ? `<p class="pde-hero-subheadline">${escapeHtml(heroSubheadline)}</p>`
    : "";
  const heroAssetAttrs = heroImage && heroSourceItem ? assetDataAttrs(heroImage, heroSourceItem.section.sectionId, "hero") : "";
  const heroBlock = heroImage
    ? `<header class="pde-hero pde-hero--photo" style="background-image:url('${dataUri(heroImage)}')" ${heroAssetAttrs}>${heroMotifLayerHtml}${zoomLink(
        heroImage,
        `<div class="pde-hero-overlay"><h1>${escapeHtml(story.productName)}</h1>${heroSubheadlineHtml}</div>`,
      )}</header>`
    : `<header class="pde-hero">${heroMotifLayerHtml}<h1>${escapeHtml(story.productName)}</h1>${heroSubheadlineHtml}</header>`;

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
      // Hero가 이미 그 사진을 크게 보여주므로, 같은 이미지를 원래 배정된
      // 섹션 본문에서 또 반복하지 않는다 — "상단 gallery와 본문에 같은
      // 이미지를 중복 배치하지 않는다"(T1-118 요청 사양). 그 섹션에 실제
      // 사진이 배정돼 있다는 사실 자체는 그대로 유지해(보조 그래픽이
      // 잘못 끼어들지 않도록) 화면 표시만 생략한다.
      const hideMedia = Boolean(heroImage) && item.image?.imageId === heroImage?.imageId;
      return renderSection(item, index, design, auxiliaryBySectionId.get(item.section.sectionId), hideMedia, generativeIcons);
    })
    .join("");

  const html = [
    '<div class="pde-page pde-page--story">',
    heroBlock,
    `<div class="pde-story-summary">${summaryMotifLayerHtml}<p>${escapeHtml(story.narrativeSummary)}</p></div>`,
    '<div class="pde-story-flow">',
    sectionsHtml,
    "</div>",
    renderMediaGallerySection(mediaGallery ?? []),
    "</div>",
  ].join("");

  const css = `
/* ============================================================
   Product Story — 광고 크리에이티브 렌더러 (T1-126)
   원칙: 카드/얇은 테두리로 구획을 나누지 않는다. 섹션마다 배경 색
   블록·큰 비주얼·큰 타이포로 스크롤 리듬을 만든다. 자세한 배경은
   이 파일 상단 주석 참고.
   ============================================================ */
.pde-page.pde-page--story {
  --pde-font-display: ${plan.typography.display};
  --pde-font-body: ${plan.typography.body};
  --pde-font-emphasis: ${plan.typography.emphasis};
  --pde-font-number: ${plan.typography.numeric};
  --pde-font-accent: ${plan.typography.accent};
  max-width: 980px;
  margin: 0 auto;
  background: #ffffff;
  font-family: var(--pde-font-body);
  color: #18181b;
  font-size: 17px;
  line-height: 1.7;
  word-break: keep-all;
  overflow: hidden;
}

/* -- Hero: full-bleed 대형 비주얼 + 강한 헤드라인 + 짧은 서브헤드라인 -- */
.pde-page--story .pde-hero {
  position: relative;
  padding: 96px 24px;
  text-align: center;
  background: linear-gradient(135deg, #1e293b, #0f172a);
  color: #fff;
}
.pde-page--story .pde-hero h1 {
  margin: 0;
  font-family: var(--pde-font-display);
  font-size: clamp(34px, 10vw, 60px);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.pde-page--story .pde-hero-subheadline {
  margin: 18px 0 0;
  font-family: var(--pde-font-emphasis);
  font-size: clamp(16px, 3.4vw, 21px);
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: -0.01em;
}
/* -- 생성형 Hero 타이포그래피 모티프: 헤드라인 뒤에 은은하게 깔리는 브러시/스월 그래픽(T1-142) -- */
.pde-page--story .pde-hero-motif {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  opacity: 0.35;
  mix-blend-mode: screen;
  pointer-events: none;
  z-index: 0;
}
.pde-page--story .pde-hero > a,
.pde-page--story .pde-hero > h1,
.pde-page--story .pde-hero > .pde-hero-subheadline {
  position: relative;
  z-index: 1;
}
.pde-page--story .pde-hero--photo {
  min-height: 82vh;
  padding: 0;
  display: flex;
  align-items: flex-end;
  background-size: cover;
  background-position: center;
  text-align: left;
}
.pde-page--story .pde-hero--photo h1 {
  font-size: clamp(30px, 9vw, 52px);
}
.pde-page--story .pde-hero--photo > a {
  display: block;
  width: 100%;
  color: inherit;
  text-decoration: none;
}
.pde-page--story .pde-hero-overlay {
  width: 100%;
  padding: 140px 24px 40px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.45) 55%, rgba(0, 0, 0, 0) 100%);
}

/* -- 아이콘 배지: 기본은 인라인 SVG, 생성형 아이콘 자산이 있으면 --gen 변형(T1-142) -- */
.pde-page--story .pde-story-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 10px;
  border-radius: 999px;
  color: var(--pde-story-accent, #334155);
  background: color-mix(in srgb, var(--pde-story-accent, #334155) 16%, white);
  vertical-align: -7px;
}
.pde-page--story .pde-story-icon--gen {
  width: 34px;
  height: 34px;
  padding: 5px;
  background: color-mix(in srgb, var(--pde-story-accent, #334155) 10%, white);
}
.pde-page--story .pde-story-icon--gen img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 0;
}

/* -- kicker 라벨: 레이아웃 의미를 나타내는 짧은 영문 accent 텍스트(이미지 아님, T1-142) -- */
.pde-page--story .pde-story-kicker {
  display: block;
  margin: 0 0 10px;
  font-family: var(--pde-font-accent);
  font-size: 13px;
  font-weight: 700;
  font-style: italic;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--pde-story-accent, #334155);
}
.pde-page--story .pde-story-section--spec-panel .pde-story-kicker,
.pde-page--story .pde-story-section--closing .pde-story-kicker {
  color: var(--pde-story-accent, #38bdf8);
}

/* -- Gemini 보조 그래픽: 실제 배경 비주얼로 쓴다(장식용 워터마크가 아니다) -- */
.pde-page--story .pde-story-aux-visual {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.55;
  pointer-events: none;
}
.pde-page--story .pde-story-aux-visual::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.92));
}

/* -- Story intro: 요약 문단이 아니라 큰 pull-quote 헤드라인처럼 -- */
.pde-page--story .pde-story-summary {
  position: relative;
  overflow: hidden;
  padding: 64px 24px;
  text-align: center;
  background: #fafafa;
}
.pde-page--story .pde-story-summary p {
  position: relative;
  z-index: 1;
  margin: 0 auto;
  max-width: 30ch;
  font-family: var(--pde-font-emphasis);
  font-size: clamp(21px, 5vw, 27px);
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: -0.01em;
  color: #18181b;
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

.pde-page--story .pde-story-flow {
  display: flex;
  flex-direction: column;
}

/* -- 섹션: 얇은 테두리 구분선을 쓰지 않는다. 배경 색 블록으로만 리듬을 만든다 -- */
.pde-page--story .pde-story-section {
  position: relative;
  padding: 56px 24px;
}
.pde-page--story .pde-story-section:last-child {
  padding-bottom: 80px;
}
.pde-page--story .pde-story-section--tone-b {
  background: #f7f7f8;
}

/* -- 공통 figure/이미지: 카드가 아니라 full-bleed 비주얼 -- */
.pde-page--story .pde-story-figure {
  margin: 0;
}
.pde-page--story .pde-story-figure > a {
  display: block;
}
.pde-page--story .pde-story-figure img {
  display: block;
  width: calc(100% + 48px);
  margin: 0 -24px 28px;
  max-width: none;
  object-fit: cover;
  border-radius: 0;
  min-height: 260px;
  max-height: 440px;
}
.pde-page--story .pde-story-figure--text-only {
  max-width: 46ch;
}
.pde-page--story .pde-story-copy {
  margin: 0;
  max-width: 38ch;
  font-size: 17px;
  line-height: 1.75;
  color: #27272a;
  white-space: pre-wrap;
}
.pde-page--story .pde-story-key-message {
  margin: 0 0 14px;
  font-family: var(--pde-font-emphasis);
  font-size: clamp(24px, 5.5vw, 32px);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: #18181b;
  max-width: 20ch;
}

/* -- split layout: 이미지와 카피를 데스크톱에서 좌우로 교차 배치(image-feature/image-text/text-only) -- */
.pde-page--story .pde-story-figure--split figcaption {
  display: block;
}

/* -- feature-highlight: 근거를 3/4-card 비주얼 그리드로 -- */
.pde-page--story .pde-story-section--feature-highlight {
  background: #ecfeff;
}
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
  background: #0d9488;
  color: #ffffff;
  font-family: var(--pde-font-emphasis);
  font-size: 17px;
  font-weight: 800;
  line-height: 1.35;
  padding: 24px 18px;
  border-radius: 4px;
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
  color: #18181b;
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
  background: var(--pde-story-accent, #1e293b);
  color: #fff;
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
  background: color-mix(in srgb, var(--pde-story-accent, #1e293b) 30%, white);
}

/* -- spec-panel: 어두운 full-bleed 밴드 위에 큰 숫자 + 짧은 라벨 그리드 -- */
.pde-page--story .pde-story-section--spec-panel {
  background: #0f172a;
  color: #fff;
}
.pde-page--story .pde-story-section--spec-panel .pde-story-key-message {
  color: #fff;
  max-width: none;
}
.pde-page--story .pde-story-section--spec-panel .pde-story-copy {
  color: rgba(255, 255, 255, 0.78);
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
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.02em;
}

/* -- notice: 두꺼운 컬러 바 + 큰 글씨의 확인 안내 밴드 -- */
.pde-page--story .pde-story-section--notice {
  background: #fffbeb;
}
.pde-page--story .pde-story-section--notice .pde-story-notice {
  border-left: 8px solid var(--pde-story-accent, #b45309);
  padding: 2px 0 2px 24px;
}
.pde-page--story .pde-story-notice-label {
  margin: 0 0 10px;
  font-family: var(--pde-font-emphasis);
  font-size: 14px;
  font-weight: 800;
  color: var(--pde-story-accent, #b45309);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pde-page--story .pde-story-section--notice .pde-story-copy {
  max-width: 42ch;
  font-size: 18px;
  font-weight: 600;
  color: #292524;
}
.pde-page--story .pde-story-section--notice .pde-story-facts {
  margin: 16px 0 0;
  padding-left: 20px;
  font-size: 15px;
  color: #78350f;
}

/* -- problem-empathy: 큰 스테이트먼트형 헤드카피, 인용부호 대신 굵은 타이포로 -- */
.pde-page--story .pde-story-section--problem-empathy {
  background: #f4f4f5;
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
  color: #18181b;
  letter-spacing: -0.01em;
}

/* -- image-feature: 근거를 채워진 강조 필(pill)로 -- 얇은 테두리 없음 */
.pde-page--story .pde-story-section--image-feature .pde-story-facts {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.pde-page--story .pde-story-section--image-feature .pde-story-facts li {
  border: none;
  color: #fff;
  background: var(--pde-story-accent, #0e7490);
  font-size: 14px;
  font-weight: 700;
  padding: 9px 18px;
  border-radius: 999px;
}

/* -- components-grid: 구성품을 카드형 그리드로 나열 (T1-138) — image-feature의 필(pill) 나열과 달리 번호 카드로 "몇 개가 들어있는지"를 한 눈에 센다 -- */
.pde-page--story .pde-story-section--components-grid {
  background: #f5f3ff;
}
.pde-page--story .pde-story-components-grid {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.pde-page--story .pde-story-components-grid li {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  border-radius: 4px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.pde-page--story .pde-story-components-index {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--pde-story-accent, #7c3aed);
  color: #fff;
  font-family: var(--pde-font-number);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 800;
}
.pde-page--story .pde-story-components-label {
  font-size: 14px;
  font-weight: 700;
  color: #18181b;
  line-height: 1.4;
}

/* -- detail-callout: 클로즈업 사진을 full-bleed로, 캡션은 이미지 위 오버레이로 -- */
.pde-page--story .pde-story-figure--callout {
  position: relative;
  margin: 0 -24px;
  width: calc(100% + 48px);
}
.pde-page--story .pde-story-figure--callout img {
  margin: 0;
  width: 100%;
  min-height: 320px;
  max-height: 520px;
}
.pde-page--story .pde-story-figure--callout figcaption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 32px 24px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
}
.pde-page--story .pde-story-copy--caption {
  margin: 0;
  max-width: none;
  font-size: 19px;
  font-weight: 700;
  color: #fff;
}

/* -- closing: 캠페인 사인오프 — 어두운 full-bleed 밴드로 확실히 다른 톤 -- */
.pde-page--story .pde-story-section--closing {
  text-align: center;
  padding: 96px 24px 112px;
  background: linear-gradient(180deg, #0f172a, #1e293b);
  color: #fff;
}
.pde-page--story .pde-story-closing-media {
  margin: 0 -24px 32px;
}
.pde-page--story .pde-story-closing-media img {
  width: 100%;
  display: block;
  object-fit: cover;
  border-radius: 0;
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
  color: #fff;
}
.pde-page--story .pde-story-copy--closing {
  max-width: 42ch;
  margin: 0 auto;
  color: rgba(255, 255, 255, 0.78);
  font-size: 17px;
}

/* -- 갤러리 스트립: 대표 이미지 하나로는 부족한 섹션(구성품 전부·디테일 여러 컷)에 붙는 보조 썸네일(T1-144) -- */
.pde-page--story .pde-story-gallery-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}
.pde-page--story .pde-story-gallery-strip img {
  display: block;
  width: 100%;
  height: 96px;
  object-fit: cover;
  border-radius: 4px;
}

/* -- 제품 더 보기: Story Section에 배정되지 못한 선택 이미지를 모두 보여주는 마지막 갤러리(T1-144) -- */
.pde-media-gallery {
  padding: 48px 24px 72px;
  background: #fafafa;
}
.pde-media-gallery-heading {
  margin: 0 0 20px;
  font-family: var(--pde-font-display, sans-serif);
  font-size: 20px;
  font-weight: 800;
  color: #18181b;
  text-align: center;
}
.pde-media-gallery-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pde-media-gallery-grid a {
  position: relative;
  display: block;
}
.pde-media-gallery-grid img {
  display: block;
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 4px;
}
.pde-media-gallery-badge {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: rgba(15, 23, 42, 0.72);
}
.pde-media-gallery-badge[data-asset-source="real"] {
  background: rgba(15, 118, 110, 0.85);
}

@media (min-width: 760px) {
  .pde-media-gallery-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  .pde-page.pde-page--story {
    font-size: 18px;
  }
  .pde-page--story .pde-story-section {
    padding: 96px 64px;
  }
  .pde-page--story .pde-story-section:last-child {
    padding-bottom: 128px;
  }
  .pde-page--story .pde-story-summary {
    padding: 88px 64px;
  }
  .pde-page--story .pde-hero {
    padding: 140px 64px;
  }
  .pde-page--story .pde-hero-overlay {
    padding: 180px 64px 64px;
  }
  .pde-page--story .pde-story-figure img {
    width: calc(100% + 128px);
    margin: 0 -64px 32px;
    min-height: 320px;
    max-height: 560px;
  }
  .pde-page--story .pde-story-figure--callout {
    margin: 0 -64px;
    width: calc(100% + 128px);
  }
  .pde-page--story .pde-story-closing-media {
    margin: 0 -64px 40px;
  }
  /* split layout: 이미지 좌/우 교차 배치, negative-margin bleed는 grid column 안에서는 해제 */
  .pde-page--story .pde-story-figure--split {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    gap: 56px;
    align-items: center;
  }
  .pde-page--story .pde-story-figure--split img {
    width: 100%;
    margin: 0;
    min-height: 420px;
    max-height: 560px;
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

  return { html, css };
}
