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

/** 특징 카드 — 사진이 있으면 썸네일(클릭 시 확대), 없으면 체크 아이콘("사진 → 핵심 설명" 구조) */
function renderFeatureCards(items: ProductPageFeatureItem[]): string {
  const cards = items.map(({ text, image }) => {
    const media = image
      ? zoomLink(image, `<span class="pde-feature-media"><img src="${dataUri(image)}" alt="" loading="lazy"></span>`)
      : `<span class="pde-feature-media pde-feature-media--icon">${ICONS.check}</span>`;
    return `<li class="pde-feature-card">${media}<span class="pde-feature-text">${escapeHtml(text)}</span></li>`;
  });
  return `<ul class="pde-feature-grid">${cards.join("")}</ul>`;
}

function renderSpecTable(rows: [string, string][]): string {
  if (rows.length === 0) {
    return "";
  }
  const body = rows
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table class="pde-spec-table"><tbody>${body}</tbody></table>`;
}

/** data URI를 그대로 새 탭에 열어 "확대사진"을 본다 — 별도 JS 없이 브라우저 기본 기능만 쓴다 */
function zoomLink(image: ProductPageImage, inner: string): string {
  return `<a href="${dataUri(image)}" target="_blank" rel="noopener" aria-label="원본 크기로 보기">${inner}</a>`;
}

/** 첫 사진을 배경으로 쓰는 Hero 영역 — 사진이 없으면 그라디언트로 대체한다. 클릭하면 원본 크기로 열린다 */
function renderHero(vm: ProductPageViewModel): string {
  const titleBlock = `<h1>${escapeHtml(vm.productName)}</h1><p class="pde-headline">${escapeHtml(vm.headline)}</p>`;
  if (!vm.heroImage) {
    return `<header class="pde-hero">${titleBlock}</header>`;
  }
  const overlay = `<div class="pde-hero-overlay">${titleBlock}</div>`;
  return `<header class="pde-hero pde-hero--photo" style="background-image:url('${dataUri(vm.heroImage)}')">${zoomLink(vm.heroImage, overlay)}</header>`;
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
function renderPurchasePoints(points: string[]): string {
  if (points.length === 0) {
    return "";
  }
  const chips = points
    .map((item) => `<li class="pde-chip">${ICONS.check}<span>${escapeHtml(item)}</span></li>`)
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
.pde-page .pde-spec-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  border: 1px solid #eee;
  border-radius: 10px;
  overflow: hidden;
}
.pde-page .pde-spec-table th,
.pde-page .pde-spec-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #f1f1f1;
}
.pde-page .pde-spec-table tr:last-child th,
.pde-page .pde-spec-table tr:last-child td {
  border-bottom: none;
}
.pde-page .pde-spec-table tr:nth-child(even) {
  background: #fafafa;
}
.pde-page .pde-spec-table th {
  width: 34%;
  font-weight: 600;
  color: #71717a;
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

/** 등록된 상세페이지 템플릿 — Prompt Engine 템플릿 레지스트리와 같은 원칙. 새 스타일은 여기에 추가한다 */
export const PRODUCT_PAGE_TEMPLATES: ProductPageTemplate[] = [BASIC_PRODUCT_PAGE_TEMPLATE];

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
