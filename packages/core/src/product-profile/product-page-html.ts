import type { ProductPageCopy, ProductProfile } from "@acos/shared";

/**
 * Product Profile → 상세페이지 HTML/CSS 렌더러. (Sprint 35 Phase 2 —
 * Product Detail Engine STEP 5의 두 번째 단계)
 *
 * STEP 5의 첫 단계(product-page-copy)가 LLM으로 대표 문구·제품 설명을
 * 만들면, 이 단계는 그 결과 + Product Profile + 구성품(STEP 3)을 **LLM
 * 없이 결정적으로** HTML/CSS로 조립한다 — 마크업 생성에는 새로운 사실
 * 판단이 필요 없고, LLM에 맡기면 같은 입력에도 다른 마크업이 나올 수
 * 있다(비용도 늘어난다).
 *
 * CTO 지시(Sprint 35 Phase 2)가 요구한 8개 섹션을 그대로 담는다: 상품명·
 * 대표문구·핵심특징(features+advantages)·제품설명·스펙표·구성품·
 * 사용방법·주의사항. `html`은 재사용 가능한 fragment(문서 전체가 아니라
 * `<div class="pde-page">...</div>` 하나)로 두고, `css`는 그 안에서만
 * 적용되도록 `.pde-page` 아래로 스코프한다 — 다른 페이지에 그대로 끼워
 *넣을 수 있게 하기 위해서다. 완전한 문서가 필요하면
 * `wrapProductProfileHtmlDocument()`를 쓴다.
 */

/** HTML 텍스트 노드에 안전하게 넣기 위한 이스케이프 — LLM이 만든 텍스트를 그대로 마크업에 넣으므로 필수다 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderList(items: string[]): string {
  return `<ul class="pde-list">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
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

function renderSection(title: string, bodyHtml: string, extraClass = ""): string {
  return `<section class="pde-section ${extraClass}"><h2>${escapeHtml(title)}</h2>${bodyHtml}</section>`;
}

export interface ProductPageHtmlResult {
  /** 재사용 가능한 fragment — 다른 페이지에 그대로 삽입할 수 있다 */
  html: string;
  /** `.pde-page` 아래로 스코프된 반응형 CSS */
  css: string;
}

/**
 * Product Profile + STEP 3 구성품 + STEP 5 카피를 하나의 HTML/CSS
 * fragment로 렌더링한다. 순수 함수(부작용·LLM 호출 없음) — 단위 테스트가
 * 실 Provider 없이 전체 마크업 규칙을 검증할 수 있다.
 */
export function renderProductProfileHtml(
  profile: ProductProfile,
  components: string[],
  copy: ProductPageCopy,
): ProductPageHtmlResult {
  const specRows: [string, string][] = [];
  if (profile.brand) specRows.push(["브랜드", profile.brand]);
  if (profile.model) specRows.push(["모델", profile.model]);
  if (profile.material) specRows.push(["재질", profile.material]);
  for (const [key, value] of Object.entries(profile.specifications)) {
    specRows.push([key, value]);
  }

  // 핵심 특징 — features와 advantages는 둘 다 "판매 포인트"라 하나의 섹션으로 합친다
  // (CTO 지시의 8개 섹션 범위를 벗어나지 않기 위해 별도 섹션을 새로 만들지 않는다)
  const highlights = [
    ...new Set([...profile.features, ...profile.advantages]),
  ];

  const sections: string[] = [];
  if (highlights.length > 0) {
    sections.push(renderSection("핵심 특징", renderList(highlights)));
  }
  sections.push(
    renderSection(
      "제품 설명",
      `<p class="pde-description">${escapeHtml(copy.description)}</p>`,
    ),
  );
  if (specRows.length > 0) {
    sections.push(renderSection("스펙", renderSpecTable(specRows)));
  }
  if (components.length > 0) {
    sections.push(renderSection("구성품", renderList(components)));
  }
  if (profile.usage) {
    sections.push(
      renderSection("사용 방법", `<p>${escapeHtml(profile.usage)}</p>`),
    );
  }
  if (profile.warnings.length > 0) {
    sections.push(
      renderSection("주의사항", renderList(profile.warnings), "pde-warning"),
    );
  }

  const html = [
    '<div class="pde-page">',
    '<header class="pde-hero">',
    `<h1>${escapeHtml(profile.productName)}</h1>`,
    `<p class="pde-headline">${escapeHtml(copy.headline)}</p>`,
    "</header>",
    ...sections,
    "</div>",
  ].join("");

  const css = `
.pde-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo",
    "Noto Sans KR", sans-serif;
  color: #1a1a1a;
  line-height: 1.6;
  word-break: keep-all;
}
.pde-page .pde-hero {
  text-align: center;
  padding: 32px 16px 28px;
  border-bottom: 1px solid #eee;
  margin-bottom: 28px;
}
.pde-page .pde-hero h1 {
  font-size: 28px;
  font-weight: 800;
  margin: 0 0 10px;
}
.pde-page .pde-headline {
  font-size: 17px;
  color: #555;
  margin: 0;
}
.pde-page .pde-section {
  margin-bottom: 32px;
}
.pde-page .pde-section h2 {
  font-size: 19px;
  font-weight: 700;
  margin: 0 0 12px;
  padding-left: 10px;
  border-left: 4px solid #2563eb;
}
.pde-page .pde-description {
  font-size: 15px;
  white-space: pre-wrap;
}
.pde-page .pde-list {
  margin: 0;
  padding-left: 20px;
}
.pde-page .pde-list li {
  margin-bottom: 6px;
}
.pde-page .pde-spec-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.pde-page .pde-spec-table th,
.pde-page .pde-spec-table td {
  border: 1px solid #e2e2e2;
  padding: 10px 14px;
  text-align: left;
}
.pde-page .pde-spec-table th {
  width: 32%;
  background: #fafafa;
  font-weight: 600;
  color: #444;
}
.pde-page .pde-warning h2 {
  border-left-color: #dc2626;
}
.pde-page .pde-warning .pde-list {
  color: #b91c1c;
}
@media (max-width: 480px) {
  .pde-page {
    padding: 16px 14px 36px;
  }
  .pde-page .pde-hero h1 {
    font-size: 22px;
  }
  .pde-page .pde-headline {
    font-size: 15px;
  }
  .pde-page .pde-spec-table th {
    width: 40%;
  }
}
`.trim();

  return { html, css };
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
<style>${css}</style>
</head>
<body>
${html}
</body>
</html>`;
}
