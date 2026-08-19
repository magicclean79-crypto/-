import type { ProductStory } from "./product-story";
import type { AssignedStorySection } from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";
import { planStoryDesign, type SectionDesignSpec, type StoryDesignPlan } from "./product-story-design";
import { iconMarkup, type StoryIconId } from "./product-page-icons";
import type { AuxiliaryVisualAsset } from "./product-story-auxiliary-visual";
import type { GenerativeVisualAsset } from "./product-story-generative-visuals";
import { buildStoryVisualTokens } from "./product-composition-art-direction";

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
  hideMedia: boolean,
  generativeIcons: Partial<Record<StoryIconId, GenerativeVisualAsset>>,
): string {
  const { section, image } = item;
  const kicker = kickerLabel(design, index);
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
  // 갤러리는 대표 사진의 표시 여부(showMedia)와 무관하게 내용이 있으면
  // 항상 보여준다(T1-147). T1-144 당시엔 갤러리가 96px 작은 썸네일이라
  // "대표 사진 없이 작은 사진들만" 남으면 어색했지만, 지금은 lifestyle
  // 이미지 밀도 요청에 맞춰 갤러리 자체가 180px 이상 큰 사진 행/그리드로
  // 커졌다 — 대표 사진이 Hero로 이미 쓰였어도(hideMedia) 갤러리에 담긴
  // 사진은 대표 사진과 다른 실제 사진이므로 그대로 보여주는 것이 이미지
  // 밀도·"제품 더보기 섹션 금지"(남은 이미지를 섹션 갤러리로 흡수하는
  // 대신 숨기지 않는다) 요청 사양에 맞다.
  const gallery =
    (item.gallery ?? []).length > 0 ? galleryStrip(item.gallery ?? [], section.sectionId, design.layout) : "";
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
  <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${highlightHeadline(section.keyMessage)}</p>
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
      <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${highlightHeadline(section.keyMessage)}</p>
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
      <p class="pde-story-key-message">${iconBadge(design, generativeIcons)}${escapeHtml(section.keyMessage)}</p>
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

/**
 * 이 섹션 헤드라인 아래에 붙는 최대 2개의 "premium feature row" 카드.
 * (T1-147, T1-162에서 레퍼런스 시안 기준 카드 스타일로 개편)
 *
 * 승인된 ChatGPT 레퍼런스 시안의 Hero는 "왼쪽 대형 제품 이미지, 오른쪽
 * 텍스트+기능 카드" 구조이고, 텍스트 쪽에는 원형 아이콘·화살표
 * affordance가 있는 카드 2개가 있다(요청 사양 "2개의 premium feature
 * rows/cards"). 새 아이콘을 지어내지 않는다 — 이미 각 Story Section에
 * 결정적으로 배정된 아이콘(`design.icon`)과 그 섹션의 실제 헤드라인
 * (`keyMessage`, LLM이 이미 검증된 사실로 쓴 짧은 카피)만 재사용한다.
 * 주의사항(notice)·마무리(closing)는 "핵심 기능" 성격이 아니라서 뺀다.
 * 화살표(→)는 사실을 나타내지 않는 순수 구조적 affordance라 Unicode
 * 문자가 아니라 `product-page-icons.ts`의 SVG(`arrow`)를 쓴다.
 *
 * T1-164 — 카드마다 "POINT 01"/"POINT 02" 작은 blue eyebrow 라벨을
 * 카드 안에 추가한다(레퍼런스 시안 요청 사양). 지어낸 값이 아니라 이
 * 카드가 이미 갖고 있는 순서(`items`의 인덱스, 최대 2개)를 그대로
 * 번호로 보여줄 뿐이다 — `kickerLabel`이 섹션 순서 번호를 재사용하는
 * 것과 같은 원칙.
 */
function heroFeatureRow(
  assignedSections: AssignedStorySection[],
  designBySectionId: Map<string, SectionDesignSpec>,
  generativeIcons: Partial<Record<StoryIconId, GenerativeVisualAsset>>,
): string {
  const items = assignedSections
    .map((item) => {
      const design = designBySectionId.get(item.section.sectionId);
      return design ? { section: item.section, design } : null;
    })
    .filter(
      (entry): entry is { section: AssignedStorySection["section"]; design: SectionDesignSpec } =>
        entry !== null && entry.design.icon !== "none" && entry.design.layout !== "notice" && entry.design.layout !== "closing",
    )
    .slice(0, 2);
  if (items.length === 0) return "";
  const chips = items
    .map(({ section, design }, index) => {
      const point = `POINT ${String(index + 1).padStart(2, "0")}`;
      return `<li class="pde-hero-feature" style="--pde-story-accent:${design.accentColor};">${iconBadge(design, generativeIcons)}<span class="pde-hero-feature-body"><span class="pde-hero-feature-point">${point}</span><span class="pde-hero-feature-label">${escapeHtml(section.keyMessage)}</span></span><span class="pde-hero-feature-arrow" aria-hidden="true">${iconMarkup("arrow")}</span></li>`;
    })
    .join("");
  return `<ul class="pde-hero-features" data-feature-count="${items.length}">${chips}</ul>`;
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
): ProductStoryHtmlResult {
  const plan = designPlan ?? planStoryDesign(story);
  // Master Art Direction Contract에서 파생된 HTML 디자인 토큰(T1-162,
  // T1-163에서 밝은 premium editorial 팔레트로 갱신) — 페이지 셸의
  // 유일한 값 출처. 순수 함수라 호출 비용이 없고, `product-story-facts-
  // panel.ts`도 같은 함수를 불러 항상 같은 값을 얻는다(단일 출처, 문서
  // 순서에 의존하는 CSS 변수 cascade가 아니라 각자 리터럴 값을 갖는다 —
  // 두 조각이 문서에서 어떤 순서로 합쳐지든 항상 같은 색이 나온다).
  const tokens = buildStoryVisualTokens();
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
  // HERO split layout(T1-147) — 왼쪽 텍스트+핵심 기능 아이콘, 오른쪽 대형
  // 제품 이미지. 승인된 레퍼런스 시안 기준. 사진이 없는 경우(fallback)는
  // 기존처럼 가운데 정렬 텍스트 Hero를 그대로 쓴다 — 보여줄 이미지가
  // 없는데 split 레이아웃을 강제하면 오른쪽이 빈 채로 남아 더 어색하다.
  const heroFeaturesHtml = heroFeatureRow(assignedSections, designBySectionId, generativeIcons);
  const heroBlock = heroImage
    ? `<header class="pde-hero pde-hero--photo">${heroMotifLayerHtml}<div class="pde-hero-grid"><div class="pde-hero-media">${zoomLink(
        heroImage,
        `<img src="${dataUri(heroImage)}" alt="${escapeHtml(story.productName)}" ${heroAssetAttrs}>`,
      )}</div><div class="pde-hero-text"><h1>${highlightHeadline(story.productName)}</h1>${heroSubheadlineHtml}${heroFeaturesHtml}</div></div></header>`
    : `<header class="pde-hero">${heroMotifLayerHtml}<h1>${escapeHtml(story.productName)}</h1>${heroSubheadlineHtml}${heroFeaturesHtml}</header>`;

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

/* -- Hero: 이미지가 없을 때(fallback)만 쓰는 가운데 정렬 텍스트 Hero -- */
.pde-page--story .pde-hero {
  position: relative;
  padding: 96px 24px;
  text-align: center;
  background: var(--pde-bg-page);
  color: var(--pde-text-primary);
}
.pde-page--story .pde-hero h1 {
  margin: 0;
  font-family: var(--pde-font-display);
  font-size: clamp(34px, 10vw, 60px);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.pde-page--story .pde-hero-subheadline {
  margin: 18px 0 0;
  font-family: var(--pde-font-emphasis);
  font-size: clamp(16px, 3.4vw, 21px);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: -0.01em;
}
/* -- 생성형 Hero 타이포그래피 모티프: 헤드라인 뒤에 은은하게 깔리는 브러시/스월 그래픽(T1-142) --
   T1-163: 페이지 배경이 밝아지면서 screen blend는 밝은 색을 더 밝게(거의
   투명하게) 만들어 버려 모티프가 사실상 안 보인다 — 밝은 배경 위에서
   자연스럽게 어우러지는 multiply로 바꾸고, 낮은 opacity로 "은은하게"를
   유지한다. -- */
.pde-page--story .pde-hero-motif {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  opacity: 0.14;
  mix-blend-mode: multiply;
  pointer-events: none;
  z-index: 0;
}
.pde-page--story .pde-hero > h1,
.pde-page--story .pde-hero > .pde-hero-subheadline,
.pde-page--story .pde-hero > .pde-hero-features {
  position: relative;
  z-index: 1;
}

/* -- HERO split(T1-147): 왼쪽 텍스트+핵심 기능 아이콘, 오른쪽 대형 제품
   이미지 — 승인된 레퍼런스 시안 기준. 모바일에서는 이미지를 위, 텍스트를
   아래로 세로 스택한다(제품이 페이지의 주인공이라는 원칙은 그대로 유지
   하되, 좁은 화면에서 좌우 분할은 각각의 폭이 너무 좁아져 읽기 어렵다). -- */
.pde-page--story .pde-hero--photo {
  padding: 0;
  text-align: left;
  background: var(--pde-bg-page);
  color: var(--pde-text-primary);
}
.pde-page--story .pde-hero-grid {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
}
/* -- HERO 제품 사진: contain + letterbox 프레임(T1-162) — 레퍼런스
   시안이 요구한 "제품이 잘리지 않는 안전 crop"을 CSS만으로 보장한다.
   기존 object-fit:cover는 프레임 비율과 실제 사진 비율이 다르면 제품
   본체를 그대로 잘라낼 수 있었다(완료 기준 "제품 사진이 잘리지
   않는다"). contain은 절대 자르지 않는 대신 남는 여백이 생기는데, 그
   여백을 페이지 배경과 같은 계열의 그라디언트(--pde-bg-image-frame)로
   채워 "빈 여백"이 아니라 "의도된 프레임"처럼 보이게 한다 — 새 이미지
   생성 없이(비용 없음) 기존 asset 그대로 안전하게 담는다. -- */
/* T1-165 — box-sizing:border-box를 명시한다. .pde-hero-media(패딩 0)와
   .pde-hero-text(패딩 64px, 아래)는 데스크톱에서 flex-basis 58%/42%로
   폭을 나눠 갖는데, box-sizing이 기본값(content-box)이면 .pde-hero-text의
   padding 128px가 42% 몫 위에 추가로 더해져 두 컬럼의 실제 차지 폭 합이
   컨테이너보다 커지고, flex-shrink가 두 컬럼을 함께 줄여 이미지가 58%
   보다 훨씬 좁게(약 50%) 렌더링되는 원인이었다(실측: 980px 컨테이너에서
   이미지 컬럼이 494px로 축소). border-box로 통일하면 58%/42%가 padding을
   포함한 실제 차지 폭을 뜻하게 되어 그대로 유지된다. */
.pde-page--story .pde-hero-media {
  position: relative;
  order: -1;
  padding: 0;
  background: var(--pde-bg-image-frame);
  box-sizing: border-box;
}
.pde-page--story .pde-hero-media > a {
  display: block;
  border-radius: var(--pde-radius-md);
  overflow: hidden;
}
/* T1-166 — editorial "corner line" motif: 갤러리 프레임에서 흔히 쓰이는
   절제된 코너 브래킷 한 쌍. 콘텐츠(제품 사진)를 가리지 않도록 프레임
   바깥 모서리에만, 아주 옅은 accent 색으로 둔다 — 장식 3종(hairline
   divider·spec-panel micro-grid·closing dot-grid) 외에 Hero 전용 4번째
   motif로, section마다 motif를 2~3개로 제한하는 원칙은 섹션 단위로는
   그대로 지킨다(Hero는 다른 motif를 쓰지 않는다). */
.pde-page--story .pde-hero-media::before,
.pde-page--story .pde-hero-media::after {
  content: "";
  position: absolute;
  width: 28px;
  height: 28px;
  border: 1.5px solid color-mix(in srgb, var(--pde-story-accent, #2563eb) 55%, transparent);
  pointer-events: none;
  z-index: 2;
}
.pde-page--story .pde-hero-media::before {
  top: 14px;
  left: 14px;
  border-right: none;
  border-bottom: none;
}
.pde-page--story .pde-hero-media::after {
  bottom: 14px;
  right: 14px;
  border-left: none;
  border-top: none;
}
/* T1-165 — 프레임 padding을 없애고, 컨테이너 높이를 이미지 실제 비율에
   맞춰 동적으로 계산한다(height:auto) — 이전의 고정 height/min-height는
   contain fit과 만나 실제 사진 비율과 다를 때 위아래에 큰 빈 여백
   (letterbox)을 만들었다. max-height는 극단적으로 세로가 긴 사진에 대한
   안전장치일 뿐, 일반적인 사진에서는 자연 비율 그대로 꽉 찬다. crop 0은
   그대로 유지된다(object-fit:contain). */
.pde-page--story .pde-hero-media img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 70vh;
  object-fit: contain;
  background: var(--pde-bg-image-frame);
}
.pde-page--story .pde-hero-text {
  padding: 40px 24px 48px;
  box-sizing: border-box;
}
.pde-page--story .pde-hero--photo h1 {
  font-family: var(--pde-font-display);
  font-size: clamp(28px, 8vw, 46px);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--pde-text-primary);
}
/* T1-164 — 헤드라인 전체가 아니라 마지막 핵심 어절만 gradient accent로
   강조한다(지원하지 않는 브라우저는 --pde-text-primary가 그대로 보이는
   안전한 fallback). feature-highlight/image-feature 섹션의 핵심 카피
   헤드라인도 같은 규칙을 공유한다. */
.pde-page--story .pde-story-headline-accent {
  background: var(--pde-accent-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.pde-page--story .pde-hero--photo .pde-hero-subheadline {
  color: var(--pde-text-secondary);
}
/* -- premium feature row 카드(T1-162) — 원형 아이콘+glow, 얇은 border, 화살표 affordance -- */
.pde-page--story .pde-hero-features {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}
.pde-page--story .pde-hero-feature {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px 22px;
  border: 1px solid var(--pde-border);
  border-radius: var(--pde-radius-lg);
  background: var(--pde-bg-panel);
  box-shadow: var(--pde-shadow-card);
}
.pde-page--story .pde-hero-feature .pde-story-icon {
  margin-right: 0;
  flex: none;
  width: 44px;
  height: 44px;
  box-shadow: var(--pde-shadow-glow);
}
/* T1-164 — "POINT 01/02" eyebrow 라벨 + 굵은 제목 2단 구성(레퍼런스 시안 요청 사양) */
.pde-page--story .pde-hero-feature-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pde-page--story .pde-hero-feature-point {
  font-family: var(--pde-font-accent);
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--pde-story-accent, #2563eb);
}
.pde-page--story .pde-hero-feature-label {
  font-family: var(--pde-font-emphasis);
  font-size: 16px;
  font-weight: 800;
  line-height: 1.4;
  color: var(--pde-text-primary);
}
.pde-page--story .pde-hero-feature-arrow {
  flex: none;
  display: inline-flex;
  color: var(--pde-story-accent, #94a3b8);
}

/* -- 아이콘 배지: 기본은 인라인 SVG, 생성형 아이콘 자산이 있으면 --gen 변형(T1-142) --
   T1-166 — "옅은 blue gradient/white surface + subtle shadow + 1px border"
   요청 사양(요청 D)에 맞춰 단색 tint 배경을 흰 표면 위 옅은 gradient로
   바꾸고 은은한 그림자를 더한다. 아이콘 자체가 텍스트보다 튀지 않도록
   크기(26px)·굵기(stroke-width 2, product-page-icons.ts)는 그대로 둔다. */
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
  background:
    linear-gradient(145deg, var(--pde-bg-surface-a) 0%, color-mix(in srgb, var(--pde-story-accent, #94a3b8) 20%, var(--pde-bg-surface-a)) 100%);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 10px -6px color-mix(in srgb, var(--pde-story-accent, #94a3b8) 45%, transparent);
  vertical-align: -7px;
}
.pde-page--story .pde-story-icon--gen {
  width: 34px;
  height: 34px;
  padding: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--pde-story-accent, #94a3b8) 16%, var(--pde-bg-panel));
}
.pde-page--story .pde-story-icon--gen img {
  width: 100%;
  height: 100%;
  /* object-fit:contain 인 채로 padding까지 있으면, gpt-image-2가 만드는
     아이콘 이미지는 항상 불투명 배경(투명 PNG 미지원 모델, T1-156 실측 —
     colorType=2/RGB, 알파 채널 없음)이라 원형 배지 안에서 이미지 자신의
     사각형 배경 모서리가 그대로 드러나 "깨진 아이콘"처럼 보였다.
     object-fit:cover + 부모 overflow:hidden으로 원 안을 이미지로 완전히
     채우고 남는 사각형 모서리를 원형으로 잘라낸다 — 새 이미지 생성 없이
     기존 자산 그대로 깨끗한 원형 배지로 보이게 한다. */
  object-fit: cover;
  border-radius: 0;
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
  color: var(--pde-text-primary);
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

/* -- 섹션: 배경 색 블록(surface A/B 교차)으로 큰 리듬을 만들고, 그 위에
   얇은 그래픽 divider 하나로 섹션 경계를 정리한다(T1-163 "섹션 사이에
   얇은 그래픽 divider" 요청 사양) — 두꺼운 카드 테두리가 아니라 폭
   전체가 아닌 중앙 hairline이라 절제된 editorial 톤을 유지한다. -- */
.pde-page--story .pde-story-section {
  position: relative;
  padding: 56px 24px;
}
/* T1-166 — hairline divider에 아주 옅은 blue tint를 섞는다("subtle blue
   gradient" 요청 D) — 순수 회색 hairline보다 페이지의 blue accent 언어와
   더 잘 어울리면서도 여전히 절제된 톤을 유지한다(불투명도는 그대로). */
.pde-page--story .pde-story-section:not(:first-of-type)::before {
  content: "";
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, #2563eb 30%, var(--pde-border-strong)) 50%,
    transparent
  );
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
.pde-page--story .pde-story-figure img {
  display: block;
  width: 100%;
  height: auto;
  margin: 0 0 28px;
  max-width: none;
  max-height: 70vh;
  object-fit: contain;
  background: var(--pde-bg-image-frame);
  border: 1px solid var(--pde-border);
  border-radius: var(--pde-radius-md);
  box-sizing: border-box;
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
.pde-page--story .pde-story-components-grid li {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--pde-bg-panel);
  border: 1px solid var(--pde-border);
  border-radius: var(--pde-radius-md);
  padding: 16px;
  box-shadow: var(--pde-shadow-card);
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
  background-image:
    radial-gradient(rgba(248, 250, 252, 0.06) 1px, transparent 1px),
    linear-gradient(160deg, #0f172a 0%, #111c34 100%);
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
   확대) — 상한이 6장으로 늘어난 만큼 썸네일이 아니라 실제로 "충분한
   크기"로 보이도록 높이를 키운다. contain + 프레임 배경(T1-162)으로
   작은 썸네일이라도 제품이 잘리지 않는다. -- */
.pde-page--story .pde-story-gallery-strip {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}
/* T1-165 — 고정 height와 내부 padding을 없애 각 셀이 자기 사진의 실제
   비율만큼만 차지하게 한다("셀을 실제로 채운다" — 요청 사양 5). 크롭은
   여전히 하지 않는다(object-fit:contain 유지, 제품 본체 crop 금지). */
.pde-page--story .pde-story-gallery-strip img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  background: var(--pde-bg-image-frame);
  border: 1px solid var(--pde-border);
  border-radius: var(--pde-radius-sm);
  box-sizing: border-box;
}

@media (min-width: 760px) {
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
  /* T1-165 — .pde-hero(사진 없을 때 fallback)와 .pde-hero--photo(사진
     있을 때)는 같은 element가 두 클래스를 동시에 갖는다
     (class="pde-hero pde-hero--photo"). 데스크톱에서 .pde-hero에만
     padding을 다시 선언하고 .pde-hero--photo는 재선언하지 않으면,
     동일 specificity에서 나중에 나온 .pde-hero 규칙이 이겨 사진 Hero의
     padding이 0에서 140px 64px로 되돌아간다 — 화면 폭 128px가 아무도
     의도하지 않은 채 사라지는 원인이었다(실측: 980px 페이지에서
     hero-grid가 852px로 줄어듦). 사진이 있을 때는 그대로 0을 유지한다. */
  .pde-page--story .pde-hero--photo {
    padding: 0;
  }
  /* HERO split: 데스크톱에서 좌(텍스트+기능 아이콘)/우(대형 제품 이미지) 2단 구성(T1-147)
     T1-165 — align-items를 stretch에서 center로 바꾼다. stretch는 텍스트
     컬럼(가변 높이)에 맞춰 이미지 컬럼을 강제로 늘려, contain fit이 그
     늘어난 높이만큼 위아래 여백을 만들었다. center는 각 컬럼이 자기
     내용(이미지는 실제 비율, 텍스트는 실제 줄 수)만큼만 차지하게 한다. */
  .pde-page--story .pde-hero-grid {
    flex-direction: row;
    align-items: center;
  }
  /* 제품 이미지 컬럼 비중은 58%로 유지(T1-164)한다. contain fit은
     그대로라 잘림은 생기지 않는다. */
  .pde-page--story .pde-hero-media {
    order: 0;
    flex: 0 1 58%;
  }
  .pde-page--story .pde-hero-media img {
    width: 100%;
    height: auto;
    max-height: 78vh;
  }
  .pde-page--story .pde-hero-text {
    flex: 1 1 42%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 64px;
  }
  .pde-page--story .pde-story-gallery-strip {
    grid-template-columns: repeat(3, 1fr);
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
