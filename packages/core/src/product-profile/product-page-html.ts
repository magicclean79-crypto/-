import type { ProductPageCopy, ProductProfile } from "@acos/shared";

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
 * **알려진 한계**: 특징-사진 배치는 순환 배치(round-robin)다 — "이 사진이
 * 이 특징을 보여준다"는 의미 기반 매칭이 아니다. 진짜 의미 기반 매칭(예:
 * "손잡이" 특징에 손잡이가 보이는 사진만)을 하려면 이미지별로 어떤 특징이
 * 보이는지 STEP 3에 추가 분석을 시켜야 하고, 그만큼 실 LLM 호출이
 * 늘어난다 — 다음 개선 후보로 남긴다.
 */

export interface ProductPageImage {
  mimeType: string;
  /** base64 인코딩된 이미지 바이트 (이미 Image Guard·리사이즈를 통과한 것) */
  base64: string;
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
  /** 순환 배치된 사진 — 사진이 하나도 없으면 null(아이콘으로 대체) */
  image: ProductPageImage | null;
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
  /** 상세 특징 — features에 사진을 순환 배치한 것("사진 → 핵심 설명" 구조) */
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

  const [heroImage, ...galleryImages] = images;
  const featureTexts = [...new Set(profile.features)];
  const features: ProductPageFeatureItem[] = featureTexts.map((text, index) => ({
    text,
    image: images.length > 0 ? images[index % images.length] : null,
  }));

  return {
    productName: profile.productName,
    headline: copy.headline,
    description: copy.description,
    heroImage: heroImage ?? null,
    galleryImages,
    purchasePoints: [...new Set(profile.advantages)],
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

// ── 자체 포함 인라인 SVG 아이콘 — 외부 아이콘 폰트·CDN 의존 없이 오프라인에서도 그대로 보인다 ──
const ICONS = {
  check:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"></polyline></svg>',
  spec:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="14" y2="17"></line></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 8l9-5 9 5-9 5-9-5z"></path><path d="M3 8v9l9 5 9-5V8"></path><line x1="12" y1="13" x2="12" y2="22"></line></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"></circle></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"></path><line x1="12" y1="10" x2="12" y2="14"></line><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"></circle></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"></circle><path d="M21 16l-5.5-5.5-4 4-3-3-5.5 5.5"></path></svg>',
} as const;

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
 * `variant`로 카드 크기/배경 스타일을 바꾼다 — 생활용품 Template A~E 비교용(Sprint 36). */
function renderFeatureCards(
  items: ProductPageFeatureItem[],
  variant: "medium" | "large" | "grid" | "plain" = "medium",
): string {
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
 * Hero로 쓴 사진을 제외한 나머지 사진을 "이미지 갤러리" 섹션으로 보여준다.
 * 썸네일을 누르면 원본 크기로 열린다("확대사진", CTO 지시) — 별도 JS 없이
 * `<a href="data:...">`로 브라우저 기본 기능만 쓴다.
 */
function renderGallerySection(images: ProductPageImage[]): string {
  if (images.length === 0) {
    return "";
  }
  const thumbs = images
    .map((image) => zoomLink(image, `<img src="${dataUri(image)}" alt="" loading="lazy">`))
    .join("");
  return renderSection("gallery", "gallery", "이미지 갤러리", `<div class="pde-gallery">${thumbs}</div>`);
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

/** A~E 공통 골격 CSS — 페이지 폭·기본 배지·특징 그리드 variant·구매포인트 chip variant·경고박스.
 * 색상/Hero/타이포는 템플릿별로 뒤에 덧붙인다. */
function sharedLivingGoodsCss(accent: string): string {
  return `
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

/** 공통 섹션 빌더 — A~E가 순서만 다르게 조합한다 */
function livingGoodsSections(vm: ProductPageViewModel, opts: {
  featureVariant: "medium" | "large" | "grid" | "plain";
  spec: "checklist" | "accordion";
}) {
  const feature = vm.features.length > 0
    ? renderSection("check", "feature", "특징", renderFeatureCards(vm.features, opts.featureVariant))
    : "";
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
  const gallery = renderGallerySection(vm.galleryImages);
  return { feature, description, usage, spec, components, warnings, gallery };
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
    const s = livingGoodsSections(vm, { featureVariant: "medium", spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--a">',
      renderPurchasePoints(vm.purchasePoints, "filled"),
      renderHero(vm, "overlay"),
      s.feature,
      s.spec,
      s.gallery,
      s.description,
      s.usage,
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
    const s = livingGoodsSections(vm, { featureVariant: "plain", spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--b">',
      renderHero(vm, "mood"),
      s.description,
      renderPurchasePoints(vm.purchasePoints, "outline"),
      s.feature,
      s.gallery,
      s.spec,
      s.usage,
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
    const s = livingGoodsSections(vm, { featureVariant: "grid", spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--c">',
      renderPurchasePoints(vm.purchasePoints, "badge"),
      renderHero(vm, "compact"),
      s.spec,
      s.feature,
      s.gallery,
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
 * Template D — "기능증명형" (living-d-proof). 생활용품 원리3·규칙4 반영:
 * Hero와 특징 카드 모두 대형 사진으로 "증거"를 강조한다(감성이 아니라
 * 기능이 실제로 작동한다는 것을 사진으로 증명). 그레이+틸 단일 액센트로
 * 차분하고 신뢰감 있는 색상 언어를 쓴다.
 */
export const LIVING_GOODS_TEMPLATE_D: ProductPageTemplate = {
  key: "living-d-proof",
  name: "생활용품 D — 기능증명형",
  description: "Hero·특징 카드 모두 대형 사진으로 기능 증거를 강조. 그레이+틸 단일 액센트.",
  render(vm) {
    const s = livingGoodsSections(vm, { featureVariant: "large", spec: "checklist" });
    const html = [
      '<div class="pde-page pde-page--d">',
      renderHero(vm, "overlay"),
      s.feature,
      renderPurchasePoints(vm.purchasePoints, "filled"),
      s.spec,
      s.gallery,
      s.description,
      s.usage,
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
    const s = livingGoodsSections(vm, { featureVariant: "plain", spec: "accordion" });
    const html = [
      '<div class="pde-page pde-page--e">',
      renderHero(vm, "spacious"),
      renderPurchasePoints(vm.purchasePoints, "outline"),
      s.feature,
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
<style>body{margin:0;background:#f4f4f5;}${css}</style>
</head>
<body>
${html}
</body>
</html>`;
}
