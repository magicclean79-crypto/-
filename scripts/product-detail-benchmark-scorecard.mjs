#!/usr/bin/env node
/**
 * Product Detail Engine — Benchmark Scorecard (T1-153).
 *
 * 이 스크립트가 실제로 확인하는 것은 "기계적으로 셀 수 있는 사실"뿐이다
 * — 이미지가 예쁜지·구도가 좋은지는 절대 판단하지 않는다
 * (`docs/MASTER_GUIDE.md` "AI가 만든 것을 AI가 검사하면 검증이 아니다").
 * 사람이 브라우저에서 직접 볼 항목은 report.humanChecksRequired에 남긴다.
 *
 * 사용:
 *   node scripts/product-detail-benchmark-scorecard.mjs [productProfileId] [apiBaseUrl]
 *   기본값: productProfileId=cmskff85t0050uldwtre10ah2, apiBaseUrl=http://localhost:4100
 *
 * 읽기 전용이다 — 이미지를 새로 생성하지 않는다(실 API 호출 없음, 무료).
 */

const productId = process.argv[2] || "cmskff85t0050uldwtre10ah2";
const apiBaseUrl = process.argv[3] || "http://localhost:4100";

const CORE_CATEGORIES = ["HERO", "FEATURE_HIGHLIGHT", "USAGE_SCENE", "DETAIL", "COMPONENTS", "OTHER"];

async function getJson(path) {
  const res = await fetch(`${apiBaseUrl}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function getText(path) {
  const res = await fetch(`${apiBaseUrl}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function main() {
  const profile = await getJson(`/product-profile/${productId}`);
  const sourceImageIds = profile.imageIds ?? [];

  // 1) Composition completeness — 6개 카테고리 각각 최신 candidate가 있는가
  const compositionByCategory = {};
  for (const category of CORE_CATEGORIES) {
    let latest = null;
    for (const sourceImageId of sourceImageIds) {
      try {
        const { results } = await getJson(
          `/image-gen/candidates?sourceImageId=${sourceImageId}&category=${category}`,
        );
        for (const image of results) {
          const meta = image.generationMetadata?.compositionMetadata;
          if (!latest || (meta?.version ?? 0) > (latest.meta?.version ?? 0)) {
            latest = { image, meta };
          }
        }
      } catch {
        // 이 소스 이미지에 대해 이 카테고리 결과가 없을 수 있다 — 정상
      }
    }
    compositionByCategory[category] = latest;
  }
  const coreFive = ["HERO", "FEATURE_HIGHLIGHT", "USAGE_SCENE", "DETAIL", "OTHER"];
  const compositionCompleteness = {
    requiredCoreFive: coreFive,
    present: coreFive.filter((c) => compositionByCategory[c]),
    missing: coreFive.filter((c) => !compositionByCategory[c]),
  };

  // 2) Product identity reference — 최소 하나의 composition에 실제 참조가 있었는가
  const referenceCounts = Object.fromEntries(
    Object.entries(compositionByCategory).map(([category, entry]) => [
      category,
      entry?.meta?.referenceIds?.length ?? 0,
    ]),
  );
  const productIdentityReferenceOk = Object.values(referenceCounts).some((count) => count > 0);

  // 3) Provider/model 기록 — 실제로 GPT Image 2로 만들어졌는가(요청 사양 primary provider 유지 확인)
  const providerModelByCategory = Object.fromEntries(
    Object.entries(compositionByCategory).map(([category, entry]) => [
      category,
      entry ? { provider: entry.meta?.provider, model: entry.meta?.model } : null,
    ]),
  );

  // 4) Art Direction Contract 다양성 — 카테고리마다 서로 다른 계약 id를 쓰는가(섹션별로 다른 composition을 의도했는지)
  const contractIds = Object.entries(compositionByCategory)
    .filter(([, entry]) => entry)
    .map(([category, entry]) => [category, entry.meta?.artDirectionContractId]);

  // 5) Final HTML 구조 검사 — canonical 정보 패널, 중복 방지, "더보기" 금지
  const html = await getText(`/product-profile/${productId}/final-html`);
  const informationCorrectness = {
    hasProductInfoPanel: html.includes("제품 사양") || html.includes("사양"),
    hasComponentsSection: countOccurrences(html, "구성품") > 0,
    hasFunctionsSection: countOccurrences(html, "주요 기능") > 0,
  };
  const duplicateCautionCount = countOccurrences(html, "사용상 주의사항");
  const productMoreCount = countOccurrences(html, "더보기");
  const imgTagCount = countOccurrences(html, "<img");
  const headlineTagCount = countOccurrences(html, "<h1") + countOccurrences(html, "<h2");
  const heroGridPresent = html.includes("pde-hero-grid") || html.includes("hero");

  const report = {
    productId,
    checkedAt: new Date().toISOString(),
    mechanicalChecks: {
      compositionCompleteness,
      productIdentityReferenceOk,
      referenceCounts,
      providerModelByCategory,
      contractIds: Object.fromEntries(contractIds),
      informationCorrectness,
      duplicateCautionCount,
      duplicateCautionOk: duplicateCautionCount === 1,
      productMoreCount,
      productMoreOk: productMoreCount === 0,
      imgTagCount,
      headlineTagCount,
      heroGridPresent,
    },
    humanChecksRequired: [
      "생성된 composition 이미지가 실제 제품과 동일한가(형태·색·재질·구성품)",
      "타이포그래피 위계(제목/본문 크기 대비)가 실제로 시각적으로 뚜렷한가",
      "아이콘 스타일이 섹션 전체에서 일관되는가",
      "여백(whitespace)이 답답하지 않고 여유 있게 느껴지는가",
      "팔레트(색감)가 섹션마다 튀지 않고 하나로 이어지는가",
      "이미지가 페이지의 시각적 주인공으로 느껴지는가(작은 카드 나열처럼 보이지 않는가)",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("스코어카드 실행 실패:", error.message);
  process.exitCode = 1;
});
