import type { ProductProfile } from "@acos/shared";
import type { ProductIdentification } from "./product-identification";
import { iconMarkup } from "./product-page-icons";

/**
 * 제품 정보/법정 표시 패널 — 검증된 값만 결정적으로 렌더링한다. (T1-139,
 * 2026-08-18)
 *
 * `product-story.ts`의 Story Section(`productFacts`)은 LLM이 섹션마다
 * "이 사실을 근거로 카피에 쓸지 말지"를 스스로 고른다 — 실측에서 재질·
 * 규격·원산지 같은 상품 정보가 최종 페이지에서 통째로 빠지는 사고가
 * 났다(T1-139 발주 사유: "재원/사양, 재질, 원산지 등 상품 정보가
 * 빠졌다"). 이 파일은 그 "쓸지 말지"라는 선택 자체를 없앤다 — Product
 * Profile/Product Package에 값이 있으면 항상 나오고, 값이 없으면 그
 * 항목만 조용히 빠진다(지어내지 않는다, `docs/MASTER_GUIDE.md` 철학).
 * LLM 호출 없음 — 순수 함수.
 *
 * **`renderProductStoryHtml`(`product-story-html.ts`)를 고치지 않는다.**
 * 이 파일이 만들어질 때 그 렌더러와 Design/Art Direction 파이프라인
 * 전체를 다시 만드는 다른 작업(T1-138)이 동시에 진행 중이었다 — 같은
 * 파일을 함께 고치면 두 작업의 변경이 서로 덮어써질 위험이 있어(같은
 * 종류의 위험이 `docs/PROJECT_MEMORY.md`에 이미 기록돼 있다), 이 패널을
 * 완전히 독립된 모듈로 두고 호출자(`apps/api` `generateStory()`)가
 * `renderProductStoryHtml()`이 돌려준 `html`/`css` 뒤에 문자열로 이어
 * 붙이게 했다. 두 렌더러 사이에 구조적 의존이 없으므로 어느 쪽이 먼저
 * 끝나도 안전하게 합쳐진다.
 */

export interface ProductFactsPanelInput {
  profile: Pick<
    ProductProfile,
    "brand" | "model" | "material" | "specifications" | "features" | "usage" | "warnings"
  >;
  identification: Pick<ProductIdentification, "origin">;
  /** STEP 3 Vision이 실제 사진에서 본 구성품 — 사진에 없는 구성품을 지어내지 않는다 */
  components: string[];
}

export interface ProductFactsPanelResult {
  html: string;
  css: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function specRow(label: string, value: string): string {
  return `<div class="pde-facts-row"><span class="pde-facts-label">${esc(label)}</span><span class="pde-facts-value">${esc(value)}</span></div>`;
}

function factsBlock(heading: string, icon: "info" | "box" | "warning" | "spec", inner: string, variant?: "warning"): string {
  const blockClass = variant === "warning" ? "pde-facts-block pde-facts-block--warning" : "pde-facts-block";
  return `<div class="${blockClass}"><h3 class="pde-facts-heading">${iconMarkup(icon)}${esc(heading)}</h3>${inner}</div>`;
}

/**
 * 검증된 Product Profile/Product Package 값만으로 "제품 정보" 패널을
 * 조립한다. 표시할 항목이 하나도 없으면(모든 필드가 비어 있으면) null —
 * 빈 패널을 억지로 그리지 않는다.
 */
export function buildProductFactsPanel(input: ProductFactsPanelInput): ProductFactsPanelResult | null {
  const { profile, identification, components } = input;

  const specRows: string[] = [];
  if (profile.brand) specRows.push(specRow("제조사/브랜드", profile.brand));
  if (profile.model) specRows.push(specRow("모델명/품번", profile.model));
  if (profile.material) specRows.push(specRow("주요 재질", profile.material));
  if (identification.origin) specRows.push(specRow("원산지/제조국", identification.origin));
  // "구성품"은 별도 섹션(아래 componentsBlock)에서 이미 다룬다 —
  // specifications에도 같은 키가 있으면(실측: STEP 4가 구성품 목록을
  // specifications["구성품"]에도 중복해 채운 사례가 있었다) 사양 표에서
  // 한 번 더 반복하지 않는다. 같은 사실을 여러 자리에 반복하지 않는
  // 원칙은 `buildImageGenerationPrompt`(product-story.ts)가 이미 쓰고
  // 있는 것과 같다.
  const componentsKeyPattern = /^구성품?$|^구성\s?품목$/;
  for (const [key, value] of Object.entries(profile.specifications)) {
    if (components.length > 0 && componentsKeyPattern.test(key.trim())) continue;
    if (value?.trim()) specRows.push(specRow(key, value));
  }
  const specBlock =
    specRows.length > 0
      ? factsBlock("제품 사양", "spec", `<div class="pde-facts-grid">${specRows.join("")}</div>`)
      : "";

  const componentsBlock =
    components.length > 0
      ? factsBlock(
          "구성품",
          "box",
          `<ul class="pde-facts-list">${components.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`,
        )
      : "";

  const usageInner = [
    profile.usage ? `<p class="pde-facts-usage">${esc(profile.usage)}</p>` : "",
    profile.features.length > 0
      ? `<ul class="pde-facts-list">${profile.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
      : "",
  ].join("");
  const usageBlock = profile.usage || profile.features.length > 0 ? factsBlock("주요 기능/용도", "info", usageInner) : "";

  const warningsBlock =
    profile.warnings.length > 0
      ? factsBlock(
          "사용상 주의사항",
          "warning",
          `<ul class="pde-facts-list">${profile.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`,
          "warning",
        )
      : "";

  if (!specBlock && !componentsBlock && !usageBlock && !warningsBlock) {
    return null;
  }

  const html = [
    '<section class="pde-facts-panel" data-panel="product-facts" aria-label="제품 정보">',
    '<h2 class="pde-facts-title">제품 정보</h2>',
    specBlock,
    componentsBlock,
    usageBlock,
    warningsBlock,
    '<p class="pde-facts-disclaimer">위 정보는 검증된 내용만 표시합니다 — 확인되지 않은 항목은 표시하지 않습니다.</p>',
    "</section>",
  ].join("");

  const css = `
.pde-facts-panel {
  max-width: 980px;
  margin: 0 auto;
  padding: 64px 24px 96px;
  background: #ffffff;
  color: #18181b;
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  word-break: keep-all;
  border-top: 1px solid #e4e4e7;
}
.pde-facts-title {
  margin: 0 0 32px;
  font-size: clamp(24px, 5vw, 32px);
  font-weight: 800;
  letter-spacing: -0.02em;
}
.pde-facts-block { margin: 0 0 40px; }
.pde-facts-block:last-of-type { margin-bottom: 24px; }
.pde-facts-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
  font-size: 19px;
  font-weight: 800;
  color: #18181b;
}
.pde-facts-heading svg { flex: none; color: #0e7490; }
.pde-facts-grid {
  display: grid;
  grid-template-columns: 1fr;
  border-top: 1px solid #e4e4e7;
}
.pde-facts-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  padding: 16px 4px;
  border-bottom: 1px solid #e4e4e7;
  font-size: 16px;
  line-height: 1.6;
}
.pde-facts-label { font-weight: 700; color: #52525b; }
.pde-facts-value { color: #18181b; font-weight: 600; white-space: pre-wrap; }
.pde-facts-usage { margin: 0 0 12px; font-size: 16px; line-height: 1.75; color: #27272a; }
.pde-facts-list { margin: 0; padding-left: 20px; font-size: 16px; line-height: 1.85; color: #27272a; }
.pde-facts-list li { margin-bottom: 6px; }
.pde-facts-block--warning {
  padding: 20px;
  background: #fffbeb;
  border-left: 6px solid #b45309;
}
.pde-facts-block--warning .pde-facts-list { color: #78350f; }
.pde-facts-disclaimer {
  margin: 32px 0 0;
  font-size: 13px;
  color: #a1a1aa;
}
@media (min-width: 760px) {
  .pde-facts-panel { padding: 96px 64px 128px; }
  .pde-facts-row { grid-template-columns: 200px 1fr; font-size: 17px; }
  .pde-facts-heading { font-size: 21px; }
}
`.trim();

  return { html, css };
}
