/**
 * 제품 자동 조사 — 제품이 식별된 경우에만, 정해진 우선순위로 공식 정보만
 * 모은다. (CTO 지시, T1-22)
 *
 * 조사 우선순위: 바코드 → 모델명 → 브랜드 → 공식 제조사 홈페이지 → 공식
 * 카탈로그 (`docs/MASTER_GUIDE.md` §4, `docs/PROJECT_MEMORY.md` M-20-1).
 *
 * ## 이 파일이 하는 일과 하지 않는 일
 *
 * 여기서는 **무엇을 몇 번째 순서로 조사할지 계획하는 것**과 **검색으로 얻은
 * URL이 공식 출처인지 판정하는 것**만 한다 — 순수 함수다. 실제 검색 호출은
 * 어댑터(`apps/api`)의 몫이다(`product-identification.ts`와 같은 경계).
 *
 * ## "공식 정보만 사용한다"를 코드로 어떻게 지키는가
 *
 * 쇼핑몰(다나와·G마켓·11번가·쿠팡·이마트·GS SHOP 등)은 절대 공식으로
 * 인정하지 않는다(M-20-1). 그 밖의 사이트도 **자동으로는 공식으로 인정하지
 * 않는다** — "브랜드 이름이 도메인에 들어 있다"는 식의 추측은 M-21에서 실제로
 * 틀린 정보(다른 규격 제품)를 가져온 사고의 원인이었다.
 *
 * 그래서 공식으로 인정하는 출처는 **둘뿐**이다.
 * 1. 포장지에서 직접 읽은(OCR) 제조사 URL과 같은 호스트 — 사람이 이미
 *    사진으로 확인한 사실이다.
 * 2. 공인 바코드 조회 기관(GS1 코리아 코리안넷) — 출처가 특정되는 유일한
 *    자동 조회 수단이다(M-21).
 *
 * 그 외의 검색 결과는 **버리지 않고 "미확인"으로 남긴다** — 하지 않기로 한
 * 것을 흔적 없이 지우면 나중에 누군가 그대로 되살린다(MASTER_GUIDE 철학 5).
 *
 * ## GPT의 기억을 사실처럼 쓰지 않는다
 *
 * 이 파일은 어떤 텍스트 생성도 하지 않는다 — 입력은 항상 실제 검색이
 * 반환한 URL·스니펫이다. "GPT에게 아는 것을 물어보는" 경로 자체가 없다
 * (M-21: "GPT에게 '아는 것'을 묻는 방식은 쓰지 않는다").
 */

import type { ProductIdentification } from "./product-identification";

export type ResearchTargetType = "barcode" | "model" | "brand" | "homepage" | "catalog";

/** 조사 계획 한 단계 — 무엇을, 어떤 질의로, 왜 이 순서인지 */
export interface ResearchTarget {
  type: ResearchTargetType;
  query: string;
  reason: string;
}

/** 실제 검색이 돌려준 결과 한 건 (어댑터가 채운다) */
export interface RawResearchResult {
  url: string;
  title?: string | null;
  snippet: string;
}

export type ResearchSourceType = "official-homepage" | "official-catalog" | "official-registry";

/** 공식 출처로 인정된 조사 결과 한 건 */
export interface ResearchFinding {
  targetType: ResearchTargetType;
  query: string;
  sourceUrl: string;
  sourceType: ResearchSourceType;
  snippet: string;
}

/** 공식으로 인정하지 않아 버린 결과 — 근거와 함께 남긴다 */
export interface ExcludedResearchResult {
  targetType: ResearchTargetType;
  url: string;
  reason: "shopping-mall" | "unverified-source";
}

export interface ProductResearchResult {
  /** skipped: 제품이 특정되지 않아 조사하지 않음 */
  status: "skipped" | "found" | "not_found";
  reason: string;
  targetsAttempted: ResearchTarget[];
  findings: ResearchFinding[];
  excluded: ExcludedResearchResult[];
}

/** 판매처 표기는 제조사 표기가 아니다 (MASTER_GUIDE §4, M-20-1) */
const SHOPPING_MALL_HOSTS = [
  "danawa.com",
  "gmarket.co.kr",
  "auction.co.kr",
  "11st.co.kr",
  "coupang.com",
  "emart.com",
  "ssg.com",
  "gsshop.com",
  "shopping.naver.com",
  "smartstore.naver.com",
  "shopping.interpark.com",
  "tmon.co.kr",
  "wemakeprice.com",
  "lotteon.com",
  "kakaoshopping.com",
  "aliexpress.com",
  "amazon.com",
  "amazon.co.jp",
];

/** 공인 바코드 조회 기관 — 유일하게 자동으로 신뢰하는 제3자 출처 (M-21) */
const OFFICIAL_BARCODE_REGISTRIES = ["koreannet.or.kr", "gs1kr.org"];

function hostnameOf(rawUrl: string): string | null {
  try {
    const withScheme = /^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** host가 target과 같거나, target의 하위 도메인이거나, target이 host의 하위 도메인이면 같은 출처로 본다 */
function sameHost(host: string, target: string): boolean {
  return host === target || host.endsWith(`.${target}`) || target.endsWith(`.${host}`);
}

function officialPackageHosts(identification: ProductIdentification): string[] {
  return identification.urls
    .map((u) => hostnameOf(u.value))
    .filter((h): h is string => Boolean(h));
}

/**
 * 조사 계획을 세운다. 제품이 특정되지 않았으면 **아예 조사하지 않는다** —
 * "제품이 식별된 경우에만 수행"(T1-22 지시).
 */
export function planProductResearch(identification: ProductIdentification): ResearchTarget[] {
  if (!identification.identified) return [];

  const targets: ResearchTarget[] = [];

  const primaryBarcode = identification.barcodes[0];
  if (primaryBarcode) {
    targets.push({
      type: "barcode",
      query: primaryBarcode.value,
      reason: "바코드는 제품을 하나로 특정하는 유일한 식별자다",
    });
  }

  if (identification.model) {
    targets.push({
      type: "model",
      query: identification.brand
        ? `${identification.brand} ${identification.model}`
        : identification.model,
      reason: "모델명·품번",
    });
  }

  if (identification.brand) {
    targets.push({
      type: "brand",
      query: identification.officialProductLabel
        ? `${identification.brand} ${identification.officialProductLabel}`
        : identification.brand,
      reason: "제조·판매원(브랜드)",
    });
  }

  const homepage = identification.urls[0];
  if (homepage) {
    targets.push({
      type: "homepage",
      query: homepage.value,
      reason: "포장지에 인쇄된 제조사 홈페이지 주소",
    });
    targets.push({
      type: "catalog",
      query: `${homepage.value} 카탈로그`,
      reason: "공식 홈페이지의 제품 카탈로그",
    });
  }

  return targets;
}

/**
 * URL 하나가 공식 출처인지 판정한다. 세 가지로만 나눈다 — 그 중간은 없다.
 *
 * - 쇼핑몰 목록에 있으면 무조건 `shopping-mall`.
 * - 포장지에서 읽은 호스트와 같으면 `official-homepage`/`official-catalog`.
 * - 공인 바코드 조회 기관이면 `official-registry`.
 * - 그 외는 전부 `unverified` — "그럴듯해 보인다"는 근거로 인정하지 않는다.
 */
export function classifyResearchSource(
  url: string,
  identification: ProductIdentification,
): ResearchSourceType | "shopping-mall" | "unverified" {
  const host = hostnameOf(url);
  if (!host) return "unverified";

  if (SHOPPING_MALL_HOSTS.some((mall) => sameHost(host, mall))) {
    return "shopping-mall";
  }

  if (OFFICIAL_BARCODE_REGISTRIES.some((registry) => sameHost(host, registry))) {
    return "official-registry";
  }

  const packageHosts = officialPackageHosts(identification);
  if (packageHosts.some((packageHost) => sameHost(host, packageHost))) {
    const lower = url.toLowerCase();
    return lower.includes("catalog") || lower.includes("카탈로그")
      ? "official-catalog"
      : "official-homepage";
  }

  return "unverified";
}

/**
 * 검색 결과 중 공식 출처만 남긴다. 나머지는 버리지 않고 `excluded`에
 * 근거와 함께 남긴다.
 */
export function filterOfficialResults(
  target: ResearchTarget,
  results: RawResearchResult[],
  identification: ProductIdentification,
): { findings: ResearchFinding[]; excluded: ExcludedResearchResult[] } {
  const findings: ResearchFinding[] = [];
  const excluded: ExcludedResearchResult[] = [];

  for (const result of results) {
    const classification = classifyResearchSource(result.url, identification);
    if (classification === "shopping-mall") {
      excluded.push({ targetType: target.type, url: result.url, reason: "shopping-mall" });
      continue;
    }
    if (classification === "unverified") {
      excluded.push({ targetType: target.type, url: result.url, reason: "unverified-source" });
      continue;
    }
    findings.push({
      targetType: target.type,
      query: target.query,
      sourceUrl: result.url,
      sourceType: classification,
      snippet: result.snippet,
    });
  }

  return { findings, excluded };
}
