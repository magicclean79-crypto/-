import type { ImageCategory, ProductPageCopy, ProductProfile } from "@acos/shared";
import { rankPurchasePoints } from "./product-page-template-selection";
import { ICONS } from "./product-page-icons";

/**
 * Product Profile → 상세페이지 HTML/CSS 렌더러. (Sprint 35 Phase 2 —
 * Product Detail Engine STEP 5의 두 번째 단계, 실사진 활용 리비전)
 *
 * STEP 5의 첫 단계(product-page-copy)가 LLM으로 대표 문구·제품 설명을
 * 만들면, 이 단계는 그 결과 + Product Profile + 구성품(STEP 3) + **실제
 * 업로드된 사진**을 **LLM 없이 결정적으로** HTML/CSS로 조립한다 — 마크업
 * 조립에는 새로운 사실 판단이 필요 없고, LLM에 맡기면 같은 입력에도 다른
 * 마크업이 나올 수 있다(비용도 늘어난다).
 *
 * ## 구조 — 데이터 준비(ViewModel)와 마크업(Template)을 분리한다
 *
 * `buildProductPageViewModel()`이 Product Profile/이미지/카피를 하나의
 * 중립적인 `ProductPageViewModel`로 정리하고, `ProductPageTemplate`이
 * 그 ViewModel을 실제 HTML/CSS로 그린다. Prompt Engine(`packages/core/
 * src/prompt/prompt-engine.ts`)의 템플릿 레지스트리와 같은 원칙 — 데이터
 * 준비 로직은 템플릿마다 다시 만들지 않고, 이후 "심플형/프리미엄형/
 * 산업용/생활용품형" 등 스타일을 추가할 때 `ProductPageTemplate`만 새로
 * 구현하면 된다. 지금은 `BASIC_PRODUCT_PAGE_TEMPLATE` 하나만 있다.
 *
 * 사진은 base64 data URI로 fragment 안에 직접 심는다(별도 이미지 서빙
 * API 없이도 미리보기·다운로드한 단독 HTML 파일 둘 다에서 그대로 보인다).
 * `html`은 재사용 가능한 fragment(`<div class="pde-page">...</div>` 하나)
 * 이고, `css`는 `.pde-page` 아래로 스코프된다. 완전한 문서가 필요하면
 * `wrapProductProfileHtmlDocument()`를 쓴다.
 *
 * ## 이미지-콘텐츠 연결 (T1-93)
 *
 * 예전에는 특징-사진 배치가 순환 배치(round-robin, `images[index %
 * images.length]`)였다 — "이 사진이 이 특징을 보여준다"는 의미 기반
 * 매칭이 아니라 그냥 인덱스로만 짝지었고, 사진 수가 특징 수보다 적으면
 * 같은 사진이 여러 캡션에 반복 등장했다. `buildProductPageViewModel`은
 * 이제 두 가지 근거 있는 신호가 있으면 그것으로 짝짓는다: (1) `ProductPageImage
 * .caption` — STEP 3(원본 사진 분석, `photoCaptions`)이나 Image Studio
 * 카테고리(`category`)에서 이미 만들어진, 그 사진 하나만을 위한 실제
 * 문장. (2) 남는 사진은 profile.features 텍스트와 1:1로만(중복 없이)
 * 짝짓는다 — 사진보다 특징이 많으면 남는 특징은 사진 없이 텍스트로만
 * 보여주고, 특징보다 사진이 많으면 캡션이 있는 사진만 카드로 보여주고
 * 캡션 없는 나머지는 "이미지 갤러리"(썸네일, 서사를 주장하지 않는 조회용
 * 영역)로 보낸다 — 근거 없는 캡션을 지어내 큰 사진 카드에 붙이지 않는다.
 */

export interface ProductPageImage {
  mimeType: string;
  /** base64 인코딩된 이미지 바이트 (이미 Image Guard·리사이즈를 통과한 것) */
  base64: string;
  /**
   * 이 사진 하나만을 위한 실제 설명(T1-93) — STEP 3 `photoCaptions`나
   * Image Studio 카테고리 기반으로 호출자가 채운다. 없으면(null/undefined)
   * 이 사진은 "특징" 카드가 아니라 캡션 없는 갤러리 후보로 취급된다 —
   * 근거 없는 텍스트를 사진 옆에 지어 붙이지 않는다.
   */
  caption?: string | null;
  /** Image Studio에서 이 사진이 어떤 역할로 만들어졌는지(T1-93) — 있으면
   * 섹션 배치·캡션 생성의 근거로 쓴다. 원본 업로드 사진에는 없다(null). */
  category?: ImageCategory | null;
}

/** HTML 텍스트 노드에 안전하게 넣기 위한 이스케이프 — LLM이 만든 텍스트를 그대로 마크업에 넣으므로 필수다 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** base64 알파벳(A-Za-z0-9+/=)에는 HTML 특수문자가 없어 별도 이스케이프가 필요 없다 */
function dataUri(image: ProductPageImage): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

// ── ViewModel — Product Profile + 이미지 + 카피를 템플릿 중립 데이터로 정리 ──

export interface ProductPageFeatureItem {
  text: string;
  /** 의미 있는 근거로 짝지어진 사진 — 사진이 없으면 null(아이콘으로 대체) */
  image: ProductPageImage | null;
}

/**
 * 특징 텍스트와 사진을 짝짓는다(T1-93) — 근거 없는 반복·빈 캡션을 만들지
 * 않는다.
 *
 * 1) profile.features 텍스트 하나마다 아직 안 쓴 사진을 하나씩만 배정한다
 *    (같은 사진을 두 번 쓰지 않는다 — 예전의 `index % images.length` 순환
 *    배치를 없앴다). 사진이 모자라면 남는 특징은 텍스트만(사진 null).
 * 2) 남은 사진 중 자기 캡션(`caption`)을 가진 것은 그 캡션을 텍스트로 써서
 *    추가 카드로 만든다 — STEP 3가 그 사진 하나만 보고 실제로 확인한
 *    내용이라 근거가 있다.
 * 3) 캡션도 없고 특징과도 안 짝지어진 사진은 여기 포함하지 않는다 —
 *    호출자가 갤러리(썸네일)로 따로 보여준다. "사진은 있는데 옆에 아무
 *    설명도 없는" 카드를 만들지 않는다는 것이 이 함수의 핵심 규칙이다.
 */
function pairFeatureTextsWithImages(
  featureTexts: string[],
  images: ProductPageImage[],
): { items: ProductPageFeatureItem[]; usedImageIndexes: Set<number> } {
  const used = new Set<number>();
  const items: ProductPageFeatureItem[] = [];

  for (const text of featureTexts) {
    const nextIndex = images.findIndex((_, i) => !used.has(i));
    if (nextIndex === -1) {
      items.push({ text, image: null });
      continue;
    }
    used.add(nextIndex);
    items.push({ text, image: images[nextIndex] });
  }

  images.forEach((image, index) => {
    if (used.has(index)) return;
    const caption = image.caption?.trim();
    if (!caption) return;
    used.add(index);
    items.push({ text: caption, image });
  });

  return { items, usedImageIndexes: used };
}

export interface ProductPageViewModel {
  productName: string;
  headline: string;
  description: string;
  /** 첫 사진 — Hero 배경으로 쓴다. 사진이 없으면 null(그라디언트로 대체) */
  heroImage: ProductPageImage | null;
  /** Hero로 쓴 사진을 제외한 나머지 */
  galleryImages: ProductPageImage[];
  /** 구매 포인트 — advantages를 CTA 칩으로 보여준다 */
  purchasePoints: string[];
  /** 상세 특징 — features 텍스트와 캡션 있는 사진을 근거 있게 1:1로 짝지은
   * 것("사진 → 핵심 설명" 구조, T1-93). 같은 사진을 두 번 쓰지 않는다. */
  features: ProductPageFeatureItem[];
  specRows: [string, string][];
  components: string[];
  usage: string | null;
  warnings: string[];
  keywords: string[];
}

/**
 * Product Profile + STEP 3 구성품 + STEP 5 카피 + 실제 업로드 사진을
 * 템플릿 중립 ViewModel로 정리한다. 순수 함수 — 어떤 템플릿을 쓰든 이
 * 준비 단계는 다시 만들지 않는다.
 */
export function buildProductPageViewModel(
  profile: ProductProfile,
  components: string[],
  copy: ProductPageCopy,
  images: ProductPageImage[] = [],
): ProductPageViewModel {
  const specRows: [string, string][] = [];
  if (profile.brand) specRows.push(["브랜드", profile.brand]);
  if (profile.model) specRows.push(["모델", profile.model]);
  if (profile.material) specRows.push(["재질", profile.material]);
  // brand/model/material/구성품은 다른 섹션에 이미 나온다 — LLM이 specifications에도
  // 같은 값을 다른 키(영문 등)로 다시 담아도 중복 행으로 보이지 않게 값 기준으로 거른다
  const alreadyShown = new Set(
    [profile.brand, profile.model, profile.material, components.join(", ")]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase()),
  );
  for (const component of components) {
    alreadyShown.add(component.trim().toLowerCase());
  }
  for (const [key, value] of Object.entries(profile.specifications)) {
    if (alreadyShown.has(value.trim().toLowerCase())) {
      continue;
    }
    specRows.push([key, value]);
  }

  const [heroImage, ...rest] = images;
  const featureTexts = [...new Set(profile.features)];
  const { items: features, usedImageIndexes } = pairFeatureTextsWithImages(featureTexts, rest);
  // 특징 카드에 이미 쓰인 사진(캡션 있는 것 포함)은 갤러리에 다시 넣지
  // 않는다 — 같은 사진이 큰 스토리 카드와 작은 썸네일에 동시에 나오면
  // 사진 개수만 부풀려 보인다(T1-93, "같은 사진의 반복 사용도 피한다").
  const galleryImages = rest.filter((_, index) => !usedImageIndexes.has(index));

  return {
    productName: profile.productName,
    headline: copy.headline,
    description: copy.description,
    heroImage: heroImage ?? null,
    galleryImages,
    purchasePoints: rankPurchasePoints(profile),
    features,
    specRows,
    components,
    usage: profile.usage,
    warnings: profile.warnings,
    keywords: profile.keywords,
  };
}

export interface ProductPageHtmlResult {
  /** 재사용 가능한 fragment — 다른 페이지에 그대로 삽입할 수 있다 */
  html: string;
  /** `.pde-page` 아래로 스코프된 반응형 CSS */
  css: string;
}

/** 상세페이지 스타일 하나(예: 기본형/심플형/프리미엄형)의 계약 — Prompt Engine 템플릿과 같은 원칙 */
export interface ProductPageTemplate {
  key: string;
  name: string;
  description: string;
  render(viewModel: ProductPageViewModel): ProductPageHtmlResult;
}

function badge(icon: keyof typeof ICONS, tone: string): string {
  return `<span class="pde-badge pde-badge--${tone}">${ICONS[icon]}</span>`;
}

function renderSection(
  icon: keyof typeof ICONS,
  tone: string,
  title: string,
  bodyHtml: string,
  extraClass = "",
): string {
  return `<section class="pde-section ${extraClass}"><h2>${badge(icon, tone)}${escapeHtml(title)}</h2>${bodyHtml}</section>`;
}

function renderPlainList(items: string[]): string {
  return `<ul class="pde-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

/** 특징 카드 — 사진이 있으면 썸네일(클릭 시 확대), 없으면 체크 아이콘("사진 → 핵심 설명" 구조)
 * `variant`로 카드 크기/배경 스타일을 바꾼다 — 생활용품 Template A~E 비교용(Sprint 36).
 * `"stacked"`는 CTO 피드백(2026-08-08 — "이미지 갤러리 형식보단 큰 사진으로 사진→설명→
 * 사진→설명 반복") 반영: 작은 썸네일 그리드가 아니라 사진 1장을 전체 폭으로 크게 보여주고
 * 그 밑에 설명을 붙인 카드를 세로로 반복한다 — 별도 "이미지 갤러리" 섹션이 필요 없어진다. */
/** 사진 1장 + 캡션 1개짜리 "스토리 카드" 하나 — `renderFeatureCards`의 stacked
 * variant와 `renderMixedStory`(특징·설명·사용법을 사진과 섞어 배치)가 공유한다. */
function renderStackedFigure({ text, image }: ProductPageFeatureItem): string {
  const media = image
    ? zoomLink(image, `<img src="${dataUri(image)}" alt="" loading="lazy">`)
    : `<span class="pde-feature-stacked-icon">${ICONS.check}</span>`;
  return `<figure class="pde-feature-stacked">${media}<figcaption>${escapeHtml(text)}</figcaption></figure>`;
}

function renderFeatureCards(
  items: ProductPageFeatureItem[],
  variant: "medium" | "large" | "grid" | "plain" | "stacked" = "medium",
): string {
  if (variant === "stacked") {
    return `<div class="pde-feature-stack">${items.map(renderStackedFigure).join("")}</div>`;
  }
  const cards = items.map(({ text, image }) => {
    const media = image
      ? zoomLink(image, `<span class="pde-feature-media"><img src="${dataUri(image)}" alt="" loading="lazy"></span>`)
      : `<span class="pde-feature-media pde-feature-media--icon">${ICONS.check}</span>`;
    return `<li class="pde-feature-card">${media}<span class="pde-feature-text">${escapeHtml(text)}</span></li>`;
  });
  return `<ul class="pde-feature-grid pde-feature-grid--${variant}">${cards.join("")}</ul>`;
}

/**
 * 스펙을 표(<table>)가 아니라 아이콘+텍스트 체크포인트 박스로 렌더링한다.
 * (Sprint 36 — 시장 조사 반영, `reports/LIVING_GOODS_DESIGN_PRINCIPLES.md`
 * 원리 5·규칙 6) 실제 캡처 53건(IKEA·다이소몰·지그재그) 전체에서 표 형태
 * 스펙 테이블이 하나도 관찰되지 않았다 — IKEA는 아코디언, 다이소는 이
 * 체크포인트 박스 스타일을 쓴다. `MAGICCLEAN_BRAND_BASELINE.md`가 이미
 * "스펙표 디자인이 시장 평균보다 약하다"고 지적한 지점과도 일치한다.
 */
function renderSpecTable(rows: [string, string][]): string {
  if (rows.length === 0) {
    return "";
  }
  const items = rows
    .map(
      ([key, value]) =>
        `<li class="pde-spec-item">${ICONS.check}<span class="pde-spec-key">${escapeHtml(key)}</span><span class="pde-spec-value">${escapeHtml(value)}</span></li>`,
    )
    .join("");
  return `<ul class="pde-spec-checklist">${items}</ul>`;
}

/** data URI를 그대로 새 탭에 열어 "확대사진"을 본다 — 별도 JS 없이 브라우저 기본 기능만 쓴다 */
function zoomLink(image: ProductPageImage, inner: string): string {
  return `<a href="${dataUri(image)}" target="_blank" rel="noopener" aria-label="원본 크기로 보기">${inner}</a>`;
}

/**
 * 첫 사진을 배경으로 쓰는 Hero 영역 — 사진이 없으면 그라디언트로 대체한다. 클릭하면 원본 크기로 열린다.
 * `variant="overlay"`(기본)는 사진 위에 제목을 얹는다("특징-사진 즉시 연결"). `variant="mood"`는
 * 오버레이 없이 사진만 풀블리드로 보여주고 제목은 사진 아래 별도 블록으로 뺀다(생활용품 원리4 —
 * 감성/라이프스타일형은 사진이 "무드"이지 정보 전달 수단이 아니라서 텍스트를 얹지 않는다).
 */
function renderHero(
  vm: ProductPageViewModel,
  variant: "overlay" | "mood" | "compact" | "spacious" = "overlay",
): string {
  const titleBlock = `<h1>${escapeHtml(vm.productName)}</h1><p class="pde-headline">${escapeHtml(vm.headline)}</p>`;
  if (!vm.heroImage) {
    return `<header class="pde-hero pde-hero--${variant}">${titleBlock}</header>`;
  }
  if (variant === "mood") {
    return [
      `<header class="pde-hero pde-hero--mood">${zoomLink(vm.heroImage, `<img src="${dataUri(vm.heroImage)}" alt="" loading="lazy">`)}</header>`,
      `<div class="pde-hero-title-block">${titleBlock}</div>`,
    ].join("");
  }
  const overlay = `<div class="pde-hero-overlay">${titleBlock}</div>`;
  return `<header class="pde-hero pde-hero--photo pde-hero--${variant}" style="background-image:url('${dataUri(vm.heroImage)}')">${zoomLink(vm.heroImage, overlay)}</header>`;
}

/** 스펙을 IKEA식 접이식 아코디언(<details>, 기본 접힘)으로 렌더링한다 — 생활용품 원리5 참고,
 * `reports/IKEA_PDP_REFERENCE_ANALYSIS.md`의 "표가 아니라 아코디언 텍스트" 관찰 반영. */
function renderSpecAccordion(rows: [string, string][]): string {
  if (rows.length === 0) {
    return "";
  }
  const items = rows
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  return `<details class="pde-spec-accordion"><summary>소재 및 상세 정보 보기</summary><dl>${items}</dl></details>`;
}

/**
 * Hero·특징 카드에 쓰이지 않고 남은 사진을 작은 썸네일로 보여준다. 이
 * 사진들은 스토리 카드로 만들 근거(캡션)가 없는 것들이라(T1-93·T1-111,
 * `attachStudioImageCaptions`) "이미지 갤러리" 같은 내부 CMS 용어 대신
 * "추가 사진"으로 정직하게 안내한다 — 이 섹션이 서사를 주장하지 않는다는
 * 뜻을 그대로 담는다(T1-111 요구사항 10, 내부 편집용 라벨을 고객에게
 * 노출하지 않는다). 썸네일을 누르면 원본 크기로 열린다("확대사진", CTO
 * 지시) — 별도 JS 없이 `<a href="data:...">`로 브라우저 기본 기능만 쓴다.
 */
function renderGallerySection(images: ProductPageImage[]): string {
  if (images.length === 0) {
    return "";
  }
  const thumbs = images
    .map((image) => zoomLink(image, `<img src="${dataUri(image)}" alt="" loading="lazy">`))
    .join("");
  return renderSection("gallery", "gallery", "추가 사진", `<div class="pde-gallery">${thumbs}</div>`);
}

/**
 * 구매 포인트(advantages) — CTA 배너 스타일의 색상 칩으로 Hero 바로 아래
 * 눈에 띄게 배치한다. "상세 특징"(features, 사진 페어링)과는 별개 섹션 —
 * 구매 포인트는 한눈에 훑는 요약, 상세 특징은 사진과 함께 자세히 보는 것.
 */
function renderPurchasePoints(
  points: string[],
  variant: "filled" | "outline" | "badge" = "filled",
): string {
  if (points.length === 0) {
    return "";
  }
  const chips = points
    .map((item) => `<li class="pde-chip pde-chip--${variant}">${ICONS.check}<span>${escapeHtml(item)}</span></li>`)
    .join("");
  return `<section class="pde-section pde-purchase-points"><ul class="pde-chip-row">${chips}</ul></section>`;
}

/**
 * 기본형(BASIC) 상세페이지 템플릿 — Template V1. (Sprint 35 Phase 2)
 *
 * 순서(CTO 확정): Hero(사진) → 구매 포인트(칩) → 이미지 갤러리(클릭 시
 * 확대) → 특징(사진 페어링 카드) → 제품 설명(보조) → 사용 방법 → 스펙표 →
 * 구성품 → 주의사항. 모바일 쇼핑몰 폭(480px)을 기준 레이아웃으로 삼고,
 * 여백을 좁혀 카드가 화면에 촘촘히 붙게 한다 — 보고서형 여백이 아니라
 * 실제 쇼핑몰 상세페이지 밀도를 목표로 한다.
 *
 * Template V1이 실제 사용 가능한 품질에 이르기 전에는 V2(산업용)·V3
 * (프리미엄)·V4(공구) 등 새 템플릿을 만들지 않는다(CTO 결정) — 이
 * 템플릿만 계속 다듬는다.
 */
export const BASIC_PRODUCT_PAGE_TEMPLATE: ProductPageTemplate = {
  key: "basic",
  name: "기본형",
  description: "Hero 이미지·구매 포인트 칩·이미지 갤러리·사진 페어링 특징 카드로 구성된 모바일 쇼핑몰 기본 템플릿(Template V1)",
  render(vm) {
    const sections: string[] = [];
    if (vm.features.length > 0) {
      sections.push(
        renderSection("check", "feature", "특징", renderFeatureCards(vm.features)),
      );
    }
    sections.push(
      renderSection(
        "info",
        "info",
        "제품 설명",
        `<p class="pde-description">${escapeHtml(vm.description)}</p>`,
      ),
    );
    if (vm.usage) {
      sections.push(
        renderSection("info", "info", "사용 방법", `<p class="pde-usage">${escapeHtml(vm.usage)}</p>`),
      );
    }
    if (vm.specRows.length > 0) {
      sections.push(renderSection("spec", "spec", "스펙", renderSpecTable(vm.specRows)));
    }
    if (vm.components.length > 0) {
      sections.push(renderSection("box", "box", "구성품", renderPlainList(vm.components)));
    }
    if (vm.warnings.length > 0) {
      sections.push(
        renderSection(
          "warning",
          "warning",
          "주의사항",
          `<div class="pde-warning-box">${renderPlainList(vm.warnings)}</div>`,
        ),
      );
    }

    const html = [
      '<div class="pde-page">',
      renderHero(vm),
      renderPurchasePoints(vm.purchasePoints),
      renderGallerySection(vm.galleryImages),
      ...sections,
      "</div>",
    ].join("");

    const css = `
${PDE_TYPOGRAPHY_CSS}
.pde-page {
  max-width: 480px;
  margin: 0 auto;
  background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo",
    "Noto Sans KR", sans-serif;
  color: #18181b;
  line-height: 1.55;
  word-break: keep-all;
}
.pde-page .pde-hero {
  position: relative;
  padding: 40px 20px;
  text-align: center;
  background: linear-gradient(135deg, #1e293b, #0f172a);
  color: #fff;
}
.pde-page .pde-hero h1 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
}
.pde-page .pde-headline {
  margin: 0;
  font-size: 13px;
  opacity: 0.85;
}
.pde-page .pde-hero--photo {
  min-height: 320px;
  padding: 0;
  display: flex;
  align-items: flex-end;
  background-size: cover;
  background-position: center;
  text-align: left;
}
.pde-page .pde-hero--photo > a {
  display: block;
  width: 100%;
  color: inherit;
  text-decoration: none;
}
.pde-page .pde-hero--photo .pde-hero-overlay {
  width: 100%;
  padding: 60px 18px 16px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0));
}
.pde-page .pde-gallery {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}
.pde-page .pde-gallery a {
  flex-shrink: 0;
  display: block;
}
.pde-page .pde-gallery img {
  width: 76px;
  height: 76px;
  object-fit: cover;
  border-radius: 8px;
  display: block;
}
.pde-page .pde-purchase-points {
  padding: 12px 14px 2px;
}
.pde-page .pde-chip-row {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pde-page .pde-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 11.5px;
  font-weight: 700;
}
.pde-page .pde-section {
  padding: 14px 14px 2px;
}
.pde-page .pde-section h2 {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14.5px;
  font-weight: 700;
  margin: 0 0 8px;
}
.pde-page .pde-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  flex-shrink: 0;
}
.pde-page .pde-badge--feature { background: #eef2ff; color: #4f46e5; }
.pde-page .pde-badge--spec { background: #f1f5f9; color: #475569; }
.pde-page .pde-badge--box { background: #ecfdf5; color: #0d9488; }
.pde-page .pde-badge--info { background: #faf5ff; color: #9333ea; }
.pde-page .pde-badge--warning { background: #fef2f2; color: #dc2626; }
.pde-page .pde-badge--gallery { background: #ecfeff; color: #0891b2; }
.pde-page .pde-feature-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pde-page .pde-feature-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f8fafc;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12.5px;
}
.pde-page .pde-feature-card > a {
  display: block;
  flex-shrink: 0;
}
.pde-page .pde-feature-media {
  display: block;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
}
.pde-page .pde-feature-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pde-page .pde-feature-media--icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eef2ff;
  color: #4f46e5;
}
.pde-page .pde-feature-text {
  flex: 1;
}
.pde-page .pde-description,
.pde-page .pde-usage {
  margin: 0;
  font-size: 12.5px;
  color: #52525b;
  background: #fafafa;
  border-radius: 10px;
  padding: 10px 12px;
  white-space: pre-wrap;
}
.pde-page .pde-spec-checklist {
  margin: 0;
  padding: 10px 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f8fafc;
  border-radius: 10px;
  font-size: 12.5px;
}
.pde-page .pde-spec-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pde-page .pde-spec-item svg {
  flex-shrink: 0;
  color: #475569;
  transform: translateY(1px);
}
.pde-page .pde-spec-key {
  font-weight: 600;
  color: #71717a;
  flex-shrink: 0;
}
.pde-page .pde-spec-value {
  color: #18181b;
}
.pde-page .pde-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pde-page .pde-list li {
  position: relative;
  padding-left: 13px;
  font-size: 12.5px;
}
.pde-page .pde-list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #a1a1aa;
}
.pde-page .pde-warning-box {
  background: #fef2f2;
  border-radius: 10px;
  padding: 10px 12px;
}
.pde-page .pde-warning-box .pde-list li {
  color: #b91c1c;
}
.pde-page .pde-warning-box .pde-list li::before {
  background: #dc2626;
}
.pde-page .pde-section:last-child {
  padding-bottom: 20px;
}
@media (min-width: 640px) {
  .pde-page {
    margin: 24px auto;
    border: 1px solid #eee;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.07);
  }
}
`.trim();

    return { html, css };
  },
};

// ── 생활용품 Template A~E (Sprint 36) ──────────────────────────────────────
//
// CTO 지시(2026-08-08): 카테고리 확장보다 "좋은 템플릿 하나를 완성하는 것"이
// 우선이다. `reports/LIVING_GOODS_DESIGN_PRINCIPLES.md`의 원리·IF-THEN 규칙을
// 근거로 Hero·사진배치·색상·아이콘·정보순서가 서로 다른 5개 템플릿을 만들어
// CTO가 브라우저에서 비교·승인할 수 있게 한다. 승인된 요소를 조합해 최종
// "생활용품 Template V1"을 만드는 것이 목표이며, 이 5개 자체가 최종 결과물은
// 아니다 — BASIC_PRODUCT_PAGE_TEMPLATE(Template V1의 현재 버전)은 그대로 둔다.

const PDE_SHARED_BASE_FONT = `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo",
    "Noto Sans KR", sans-serif;`;

/**
 * 타이포그래피 토큰 (T1-77). 지금까지는 템플릿마다 px 값을 흩어 적어
 * "왜 이 크기인지" 근거가 없었다 — CSS 커스텀 프로퍼티로 한 곳에 모으고,
 * 각 값의 근거를 주석으로 남긴다.
 *
 * - 제목/본문 크기 대비를 명확히 한다(제목 22px : 본문 13px ≈ 1.7배) —
 *   한 화면에서 정보 위계가 바로 구분되어야 한다는 원리(생활용품 원리6·
 *   `MAGICCLEAN_BRAND_BASELINE.md` §3 "표준 산세리프, 소형 크기, 촘촘한
 *   줄간격").
 * - 본문 줄간격(1.6)은 제목 줄간격(1.25)보다 넉넉하게 — 짧은 제목은
 *   빽빽해도 읽히지만 여러 줄 본문은 줄간격이 좁으면 한글 특유의 밀집된
 *   자소 때문에 읽기 어렵다.
 * - 숫자(스펙 수치·규격)에는 `font-variant-numeric: tabular-nums`를 줘서
 *   자릿수가 바뀌어도 정렬이 흔들리지 않게 한다 — "3M"·"5mm"처럼 숫자+
 *   단위가 많은 이 프로젝트 특성(호스 규격·매트 두께 등) 때문에 숫자
 *   가독성을 별도로 신경 쓴다(T1-77 요구사항7).
 * - 본문 문단은 `max-width`로 한 줄 글자 수를 제한한다 — 페이지 자체가
 *   480px 모바일 폭이라 이미 짧지만, 그 안에서도 카드형 텍스트(설명·
 *   사용법)는 더 좁게 잡아 스캔하기 쉽게 한다.
 */
const PDE_TYPOGRAPHY_CSS = `
.pde-page {
  --pde-fs-h1: 22px;
  --pde-fs-h2: 15px;
  --pde-fs-body: 13px;
  --pde-fs-small: 12px;
  --pde-lh-heading: 1.25;
  --pde-lh-body: 1.6;
  --pde-ls-heading: -0.01em;
  --pde-ls-body: 0.01em;
}
.pde-page h1 { font-size: var(--pde-fs-h1); line-height: var(--pde-lh-heading); letter-spacing: var(--pde-ls-heading); }
.pde-page h2 { font-size: var(--pde-fs-h2); line-height: var(--pde-lh-heading); letter-spacing: var(--pde-ls-heading); }
.pde-page .pde-description p,
.pde-page .pde-description,
.pde-page .pde-usage,
.pde-page .pde-story-text p {
  font-size: var(--pde-fs-body);
  line-height: var(--pde-lh-body);
  letter-spacing: var(--pde-ls-body);
  max-width: 38ch;
}
.pde-page .pde-spec-key,
.pde-page .pde-spec-value,
.pde-page .pde-headline {
  font-variant-numeric: tabular-nums;
}
`;

/** A~E 공통 골격 CSS — 페이지 폭·기본 배지·특징 그리드 variant·구매포인트 chip variant·경고박스.
 * 색상/Hero/타이포는 템플릿별로 뒤에 덧붙인다. */
function sharedLivingGoodsCss(accent: string): string {
  return `
${PDE_TYPOGRAPHY_CSS}
.pde-page {
  max-width: 480px;
  margin: 0 auto;
  background: #ffffff;
  ${PDE_SHARED_BASE_FONT}
  color: #18181b;
  line-height: 1.55;
  word-break: keep-all;
}
.pde-page .pde-gallery { display: flex; gap: 6px; overflow-x: auto; }
.pde-page .pde-gallery a { flex-shrink: 0; display: block; }
.pde-page .pde-gallery img { width: 76px; height: 76px; object-fit: cover; border-radius: 8px; display: block; }
.pde-page .pde-section { padding: 14px 14px 2px; }
.pde-page .pde-section h2 { display: flex; align-items: center; gap: 7px; font-size: 14.5px; font-weight: 700; margin: 0 0 8px; }
.pde-page .pde-badge { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 7px; flex-shrink: 0; }
.pde-page .pde-badge--feature { background: color-mix(in srgb, ${accent} 12%, white); color: ${accent}; }
.pde-page .pde-badge--spec { background: #f1f5f9; color: #475569; }
.pde-page .pde-badge--box { background: #ecfdf5; color: #0d9488; }
.pde-page .pde-badge--info { background: color-mix(in srgb, ${accent} 10%, white); color: ${accent}; }
.pde-page .pde-badge--warning { background: #fef2f2; color: #dc2626; }
.pde-page .pde-badge--gallery { background: #ecfeff; color: #0891b2; }
.pde-page .pde-chip-row { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.pde-page .pde-chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 6px 12px; font-size: 11.5px; font-weight: 700; }
.pde-page .pde-chip--filled { background: ${accent}; color: #fff; }
.pde-page .pde-chip--outline { background: #fff; color: ${accent}; border: 1.5px solid ${accent}; }
.pde-page .pde-chip--badge { background: #fef08a; color: #78350f; border: 1px solid #facc15; }
.pde-page .pde-purchase-points { padding: 12px 14px 2px; }
.pde-page .pde-feature-grid { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pde-page .pde-feature-card { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.pde-page .pde-feature-card > a { display: block; flex-shrink: 0; }
.pde-page .pde-feature-media { display: block; flex-shrink: 0; border-radius: 8px; overflow: hidden; }
.pde-page .pde-feature-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pde-page .pde-feature-media--icon { display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, ${accent} 12%, white); color: ${accent}; }
.pde-page .pde-feature-grid--medium .pde-feature-card { background: #f8fafc; border-radius: 10px; padding: 8px 10px; }
.pde-page .pde-feature-grid--medium .pde-feature-media { width: 40px; height: 40px; }
.pde-page .pde-feature-grid--large .pde-feature-card { background: #f8fafc; border-radius: 12px; padding: 10px; }
.pde-page .pde-feature-grid--large .pde-feature-media { width: 72px; height: 72px; }
.pde-page .pde-feature-grid--large .pde-feature-text { font-size: 13.5px; font-weight: 600; }
.pde-page .pde-feature-grid--grid { flex-direction: row; flex-wrap: wrap; gap: 8px; }
.pde-page .pde-feature-grid--grid .pde-feature-card { flex-direction: column; width: calc(50% - 4px); background: #fff; border: 1px solid #f1f1f1; border-radius: 10px; padding: 8px; text-align: center; }
.pde-page .pde-feature-grid--grid .pde-feature-media { width: 56px; height: 56px; margin: 0 auto; }
.pde-page .pde-feature-grid--plain .pde-feature-card { border-bottom: 1px solid #f1f1f1; padding: 10px 0; border-radius: 0; }
.pde-page .pde-feature-grid--plain .pde-feature-media { width: 40px; height: 40px; }
.pde-page .pde-feature-stack { display: flex; flex-direction: column; gap: 28px; padding: 4px 14px 18px; }
.pde-page .pde-feature-stacked { margin: 0; }
.pde-page .pde-feature-stacked > a { display: block; }
.pde-page .pde-feature-stacked img { width: 100%; border-radius: 12px; display: block; object-fit: cover; }
.pde-page .pde-feature-stacked figcaption { margin-top: 10px; font-size: 13.5px; font-weight: 600; color: #27272a; line-height: 1.5; }
.pde-page .pde-feature-stacked:has(figcaption:empty) figcaption { display: none; }
.pde-page .pde-feature-stacked-icon { display: flex; align-items: center; justify-content: center; width: 100%; height: 160px; border-radius: 12px; background: color-mix(in srgb, ${accent} 10%, white); color: ${accent}; }
.pde-page .pde-story-text { padding: 2px 2px 6px; }
.pde-page .pde-story-text p { margin: 0; font-size: 13px; color: #52525b; line-height: 1.7; white-space: pre-wrap; }
.pde-page .pde-description, .pde-page .pde-usage { margin: 0; font-size: 12.5px; color: #52525b; background: #fafafa; border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; }
.pde-page .pde-spec-checklist { margin: 0; padding: 10px 12px; list-style: none; display: flex; flex-direction: column; gap: 8px; background: #f8fafc; border-radius: 10px; font-size: 12.5px; }
.pde-page .pde-spec-item { display: flex; align-items: baseline; gap: 8px; }
.pde-page .pde-spec-item svg { flex-shrink: 0; color: ${accent}; transform: translateY(1px); }
.pde-page .pde-spec-key { font-weight: 600; color: #71717a; flex-shrink: 0; }
.pde-page .pde-spec-value { color: #18181b; }
.pde-page .pde-spec-accordion { background: #f8fafc; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
.pde-page .pde-spec-accordion summary { cursor: pointer; font-weight: 600; color: #475569; }
.pde-page .pde-spec-accordion dl { margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; }
.pde-page .pde-spec-accordion dt { font-weight: 600; color: #71717a; }
.pde-page .pde-spec-accordion dd { margin: 0 0 4px; }
.pde-page .pde-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.pde-page .pde-list li { position: relative; padding-left: 13px; font-size: 12.5px; }
.pde-page .pde-list li::before { content: ""; position: absolute; left: 0; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: #a1a1aa; }
.pde-page .pde-warning-box { background: #fef2f2; border-radius: 10px; padding: 10px 12px; }
.pde-page .pde-warning-box .pde-list li { color: #b91c1c; }
.pde-page .pde-warning-box .pde-list li::before { background: #dc2626; }
.pde-page .pde-section:last-child { padding-bottom: 20px; }
@media (min-width: 640px) {
  .pde-page { margin: 24px auto; border: 1px solid #eee; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.07); }
}
`;
}

/**
 * 특징·제품설명·사용방법을 사진과 섞어서 하나의 "스토리" 블록으로 배치한다.
 * (CTO 지시, 2026-08-08 — Template D/V15 기준: "특징과 제품설명 사용방법을
 * 제품사진과 적절하게 섞어서 중간에 배치하고 하단에 스펙·구성품·주의사항을
 * 배치") 순서: 사진1 → 제품설명 → 사진2 → 사진3 → ... → 사용방법.
 * `vm.features`(캡션 있는 사진만, T1-93)를 그대로 쓴다 — 캡션 없는 사진을
 * 빈 설명으로 끼워 넣지 않는다. 캡션 없는 나머지 사진은 호출자가 별도
 * "이미지 갤러리" 섹션(`renderGallerySection`)으로 정직하게 보여준다.
 */
function renderMixedStory(vm: ProductPageViewModel): string {
  const items = vm.features;
  const descBlock = vm.description
    ? `<div class="pde-story-text"><p>${escapeHtml(vm.description)}</p></div>`
    : "";
  const usageBlock = vm.usage
    ? `<div class="pde-story-text"><p>${escapeHtml(vm.usage)}</p></div>`
    : "";
  const descInsertIndex = Math.min(1, items.length);
  const blocks: string[] = [];
  items.forEach((item, idx) => {
    if (idx === descInsertIndex) blocks.push(descBlock);
    blocks.push(renderStackedFigure(item));
  });
  if (descInsertIndex >= items.length) blocks.push(descBlock);
  blocks.push(usageBlock);
  return `<div class="pde-feature-stack">${blocks.join("")}</div>`;
}

/**
 * 공통 섹션 빌더 — A~E가 순서만 다르게 조합한다.
 * (CTO 피드백, 2026-08-08: "메인사진 위, 상품제목, 그다음 사진→설명→사진→설명
 * 반복, 그 밑에 특징·스펙·주의사항 나열") Hero 다음에 오는 "사진 스토리"
 * 블록은 작은 이미지 갤러리·작은 특징 카드를 대체한다 — 사진은 전체 폭으로
 * 크게, 설명은 그 바로 아래에 붙인다.
 *
 * 별도 "특징" 불릿 목록은 두지 않는다(T1-111) — `photoStory`
 * (`renderFeatureCards(..., "stacked")`)가 사진이 있든 없든(없으면 아이콘
 * 으로 대체) 모든 특징 문장을 이미 카드로 보여준다(`renderStackedFigure`).
 * 예전에는 그 카드들과 똑같은 문장을 아래에 플레인 불릿 목록으로 다시
 * 나열해, 같은 문구가 두 곳에 그대로 반복됐다(사람 확인, "특징 영역에...
 * 문구가 반복됨"). `living-d-proof`(기능증명형)는 이미 이 원칙대로 별도
 * 특징 목록 없이 `renderMixedStory` 하나로 충분했다 — A/B/C/E도 같은
 * 원칙을 따른다.
 */
function livingGoodsSections(vm: ProductPageViewModel, opts: {
  spec: "checklist" | "accordion";
}) {
  const photoStory = renderFeatureCards(vm.features, "stacked");
  // 캡션(근거) 없이는 큰 스토리 카드로 보여주지 않은 나머지 사진 — 서사를
  // 주장하지 않는 조회용 썸네일로만 정직하게 보여준다(T1-93).
  const gallery = renderGallerySection(vm.galleryImages);
  const description = renderSection("info", "info", "제품 설명", `<p class="pde-description">${escapeHtml(vm.description)}</p>`);
  const usage = vm.usage
    ? renderSection("info", "info", "사용 방법", `<p class="pde-usage">${escapeHtml(vm.usage)}</p>`)
    : "";
  const spec = vm.specRows.length > 0
    ? renderSection(
        "spec",
        "spec",
        "스펙",
        opts.spec === "accordion" ? renderSpecAccordion(vm.specRows) : renderSpecTable(vm.specRows),
      )
    : "";
  const components = vm.components.length > 0
    ? renderSection("box", "box", "구성품", renderPlainList(vm.components))
    : "";
  const warnings = vm.warnings.length > 0
    ? renderSection("warning", "warning", "주의사항", `<div class="pde-warning-box">${renderPlainList(vm.warnings)}</div>`)
    : "";
  return { photoStory, gallery, description, usage, spec, components, warnings };
}

/**
 * Template A — "신뢰/근거형" (living-a-trust). 생활용품 원리1·규칙4·규칙6 반영:
 * 구매 포인트를 Hero 앞에 먼저 내세우고, 특징(사진 증거) 바로 뒤에 스펙
 * 체크포인트를 붙여 "근거를 눌러서 쌓는" 순서로 배치한다. 색상은 시장
 * 관습(IKEA·다이소 공통 블루 CTA)을 따른 블루 단일 액센트.
 */
export const LIVING_GOODS_TEMPLATE_A: ProductPageTemplate = {
  key: "living-a-trust",
  name: "생활용품 A — 신뢰/근거형",
  description: "구매포인트 → Hero → 특징(증거 사진) → 스펙 체크리스트 순으로 근거를 쌓는 구성. 블루 단일 액센트.",
  render(vm) {
    const s = livingGoodsSections(vm, { spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--a">',
      renderHero(vm, "overlay"),
      renderPurchasePoints(vm.purchasePoints, "filled"),
      s.photoStory,
      s.gallery,
      s.description,
      s.usage,
      s.spec,
      s.components,
      s.warnings,
      "</div>",
    ].join("");
    const css = sharedLivingGoodsCss("#2563eb") + `
.pde-page--a .pde-hero { position: relative; padding: 40px 20px; text-align: center; background: linear-gradient(135deg, #1e3a8a, #1e293b); color: #fff; }
.pde-page--a .pde-hero h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; }
.pde-page--a .pde-headline { margin: 0; font-size: 13px; opacity: 0.85; }
.pde-page--a .pde-hero--photo { min-height: 300px; padding: 0; display: flex; align-items: flex-end; background-size: cover; background-position: center; text-align: left; }
.pde-page--a .pde-hero--photo > a { display: block; width: 100%; color: inherit; text-decoration: none; }
.pde-page--a .pde-hero--photo .pde-hero-overlay { width: 100%; padding: 50px 18px 16px; background: linear-gradient(to top, rgba(30,58,138,0.88), rgba(0,0,0,0)); }
`.trim();
    return { html, css };
  },
};

/**
 * Template B — "감성/무드형" (living-b-mood). 생활용품 원리4·규칙5·규칙10
 * 반영: Hero는 텍스트 오버레이 없는 풀블리드 무드샷이고, 제품 설명(감성
 * 문구)이 구매포인트보다 먼저 나온다. 색상은 웜톤(테라코타)로 IKEA/다이소의
 * 블루 CTA 관습과 의도적으로 다르게 구성해 비교 대상이 되게 한다.
 */
export const LIVING_GOODS_TEMPLATE_B: ProductPageTemplate = {
  key: "living-b-mood",
  name: "생활용품 B — 감성/무드형",
  description: "오버레이 없는 풀블리드 무드 Hero → 설명 먼저 → 구매포인트(아웃라인) 순. 웜톤 테라코타 액센트, 세리프 헤드라인.",
  render(vm) {
    const s = livingGoodsSections(vm, { spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--b">',
      renderHero(vm, "mood"),
      renderPurchasePoints(vm.purchasePoints, "outline"),
      s.photoStory,
      s.gallery,
      s.description,
      s.usage,
      s.spec,
      s.components,
      s.warnings,
      "</div>",
    ].join("");
    const css = sharedLivingGoodsCss("#c2410c") + `
.pde-page--b .pde-hero { padding: 0; }
.pde-page--b .pde-hero--mood img { width: 100%; display: block; }
.pde-page--b .pde-hero-title-block { padding: 18px 16px 4px; text-align: left; }
.pde-page--b .pde-hero-title-block h1 { margin: 0 0 6px; font-size: 21px; font-weight: 700; font-family: Georgia, "Noto Serif KR", serif; color: #431407; }
.pde-page--b .pde-headline { margin: 0; font-size: 13px; color: #78716c; font-style: italic; }
`.trim();
    return { html, css };
  },
};

/**
 * Template C — "즉시구매/가격강조형" (living-c-value). 생활용품 원리8·규칙9
 * 반영: 구매포인트를 노란 가격배지 스타일로 Hero보다 먼저 배치하고, 특징
 * 카드도 다이소식 2열 그리드(작은 정사각 사진)로 눌러 정보 밀도를 높인다.
 * 색상은 레드/옐로 — 저가·즉시구매형 채널(다이소몰)의 관습을 반영.
 */
export const LIVING_GOODS_TEMPLATE_C: ProductPageTemplate = {
  key: "living-c-value",
  name: "생활용품 C — 즉시구매/가격강조형",
  description: "구매포인트(가격 배지 스타일)를 Hero보다 먼저 배치, 특징은 2열 그리드로 촘촘하게. 레드/옐로 액센트.",
  render(vm) {
    const s = livingGoodsSections(vm, { spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--c">',
      renderHero(vm, "compact"),
      renderPurchasePoints(vm.purchasePoints, "badge"),
      s.photoStory,
      s.gallery,
      s.spec,
      s.description,
      s.usage,
      s.components,
      s.warnings,
      "</div>",
    ].join("");
    const css = sharedLivingGoodsCss("#dc2626") + `
.pde-page--c .pde-section { padding: 10px 12px 2px; }
.pde-page--c .pde-hero { position: relative; padding: 20px 16px; text-align: left; background: #fff5f5; color: #18181b; }
.pde-page--c .pde-hero h1 { margin: 0 0 4px; font-size: 17px; font-weight: 800; }
.pde-page--c .pde-headline { margin: 0; font-size: 12px; color: #71717a; }
.pde-page--c .pde-hero--photo { min-height: 200px; padding: 0; display: flex; align-items: flex-end; background-size: cover; background-position: center; text-align: left; }
.pde-page--c .pde-hero--photo > a { display: block; width: 100%; color: inherit; text-decoration: none; }
.pde-page--c .pde-hero--photo .pde-hero-overlay { width: 100%; padding: 30px 14px 10px; background: linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0)); color: #fff; }
`.trim();
    return { html, css };
  },
};

/**
 * Template D — "기능증명형" (living-d-proof). 생활용품 원리3·규칙4 반영 +
 * CTO 확정 지시(2026-08-08, V15 기준): Hero와 큰 사진 모두로 "증거"를
 * 강조하고, 특징·제품설명·사용방법을 사진과 섞어 중간에 배치한 뒤(
 * `renderMixedStory`) 스펙·구성품·주의사항은 하단에 모아 정리한다.
 * 그레이+틸 단일 액센트로 차분하고 신뢰감 있는 색상 언어를 쓴다.
 */
export const LIVING_GOODS_TEMPLATE_D: ProductPageTemplate = {
  key: "living-d-proof",
  name: "생활용품 D — 기능증명형 (CTO 확정 기준)",
  description: "Hero + 사진 속에 특징·제품설명·사용방법을 섞어 배치, 하단에 스펙·구성품·주의사항 정리. 그레이+틸 단일 액센트.",
  render(vm) {
    const s = livingGoodsSections(vm, { spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--d">',
      renderHero(vm, "overlay"),
      renderPurchasePoints(vm.purchasePoints, "filled"),
      renderMixedStory(vm),
      s.gallery,
      s.spec,
      s.components,
      s.warnings,
      "</div>",
    ].join("");
    const css = sharedLivingGoodsCss("#0d9488") + `
.pde-page--d .pde-hero { position: relative; padding: 0; text-align: left; background: #27272a; color: #fff; }
.pde-page--d .pde-hero h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; }
.pde-page--d .pde-headline { margin: 0; font-size: 13px; opacity: 0.85; }
.pde-page--d .pde-hero--photo { min-height: 360px; display: flex; align-items: flex-end; background-size: cover; background-position: center; }
.pde-page--d .pde-hero--photo > a { display: block; width: 100%; color: inherit; text-decoration: none; }
.pde-page--d .pde-hero--photo .pde-hero-overlay { width: 100%; padding: 60px 18px 16px; background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0)); }
.pde-page--d .pde-warning-box { border: 1.5px solid #dc2626; }
`.trim();
    return { html, css };
  },
};

/**
 * Template E — "미니멀 스칸디나비아형" (living-e-minimal). 생활용품 원리5 +
 * `reports/IKEA_PDP_REFERENCE_ANALYSIS.md`의 "표가 아니라 아코디언, 절제된
 * 색상 시스템" 관찰 반영: 스펙을 네이티브 `<details>` 아코디언(기본 접힘)으로
 * 두고, 색상은 거의 무채색 + 블루 액센트 하나만 쓴다. 여백을 가장 넉넉하게.
 */
export const LIVING_GOODS_TEMPLATE_E: ProductPageTemplate = {
  key: "living-e-minimal",
  name: "생활용품 E — 미니멀 스칸디나비아형",
  description: "무채색 + 블루 단일 액센트, 넉넉한 여백, 스펙은 IKEA식 접이식 아코디언(기본 접힘).",
  render(vm) {
    const s = livingGoodsSections(vm, { spec: "accordion" });
    const html = [
      '<div class="pde-page pde-page--e">',
      renderHero(vm, "spacious"),
      renderPurchasePoints(vm.purchasePoints, "outline"),
      s.photoStory,
      s.gallery,
      s.description,
      s.usage,
      s.spec,
      s.components,
      s.warnings,
      "</div>",
    ].join("");
    const css = sharedLivingGoodsCss("#2563eb") + `
.pde-page--e { line-height: 1.75; }
.pde-page--e .pde-section { padding: 20px 18px 4px; }
.pde-page--e .pde-hero { position: relative; padding: 56px 22px; text-align: center; background: #fafafa; color: #18181b; }
.pde-page--e .pde-hero h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: 0.2px; }
.pde-page--e .pde-headline { margin: 0; font-size: 13.5px; color: #71717a; }
.pde-page--e .pde-hero--photo { min-height: 340px; padding: 0; display: flex; align-items: flex-end; background-size: cover; background-position: center; text-align: left; }
.pde-page--e .pde-hero--photo > a { display: block; width: 100%; color: inherit; text-decoration: none; }
.pde-page--e .pde-hero--photo .pde-hero-overlay { width: 100%; padding: 70px 22px 22px; background: linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0)); color: #fff; }
.pde-page--e .pde-warning-box { background: #fafafa; border: 1px solid #f1f1f1; }
.pde-page--e .pde-warning-box .pde-list li { color: #71717a; }
.pde-page--e .pde-warning-box .pde-list li::before { background: #a1a1aa; }
`.trim();
    return { html, css };
  },
};

/** 등록된 상세페이지 템플릿 — Prompt Engine 템플릿 레지스트리와 같은 원칙. 새 스타일은 여기에 추가한다 */
export const PRODUCT_PAGE_TEMPLATES: ProductPageTemplate[] = [
  BASIC_PRODUCT_PAGE_TEMPLATE,
  LIVING_GOODS_TEMPLATE_A,
  LIVING_GOODS_TEMPLATE_B,
  LIVING_GOODS_TEMPLATE_C,
  LIVING_GOODS_TEMPLATE_D,
  LIVING_GOODS_TEMPLATE_E,
];

function findTemplate(key: string): ProductPageTemplate {
  const found = PRODUCT_PAGE_TEMPLATES.find((template) => template.key === key);
  if (!found) {
    throw new Error(
      `등록되지 않은 상세페이지 템플릿입니다: "${key}" (등록됨: ${PRODUCT_PAGE_TEMPLATES.map((t) => t.key).join(", ")})`,
    );
  }
  return found;
}

/**
 * Product Profile + STEP 3 구성품 + STEP 5 카피 + 실제 업로드 사진을
 * 하나의 HTML/CSS fragment로 렌더링한다. 순수 함수(부작용·LLM 호출 없음) —
 * 단위 테스트가 실 Provider 없이 전체 마크업 규칙을 검증할 수 있다.
 *
 * `templateKey`를 지정하지 않으면 `BASIC_PRODUCT_PAGE_TEMPLATE`을 쓴다.
 */
export function renderProductProfileHtml(
  profile: ProductProfile,
  components: string[],
  copy: ProductPageCopy,
  images: ProductPageImage[] = [],
  templateKey: string = BASIC_PRODUCT_PAGE_TEMPLATE.key,
): ProductPageHtmlResult {
  const viewModel = buildProductPageViewModel(profile, components, copy, images);
  return findTemplate(templateKey).render(viewModel);
}

/** fragment + css를 다운로드·미리보기용 완전한 HTML 문서로 감싼다 */
export function wrapProductProfileHtmlDocument(
  title: string,
  html: string,
  css: string,
  keywords: string[] = [],
): string {
  const metaKeywords =
    keywords.length > 0
      ? `<meta name="keywords" content="${escapeHtml(keywords.join(", "))}">`
      : "";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${metaKeywords}
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>body{margin:0;background:#f4f4f5;}${css}</style>
</head>
<body>
${html}
</body>
</html>`;
}
