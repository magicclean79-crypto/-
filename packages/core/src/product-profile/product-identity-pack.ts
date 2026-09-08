import type { ImageCategory, ProductPackage } from "@acos/shared";
import type { RankedReference } from "./product-reference-hierarchy";

/**
 * Product Identity Pack (T1-153).
 *
 * ChatGPT가 상세페이지를 직접 만들 때의 핵심 단계 중 하나 —
 * "실제 제품이 무엇인지"를 이미지 생성 이전에 명시적으로 정리해 두는
 * 단계를 이 파이프라인의 개념으로 옮긴다. 지금까지도 실제 제품 동일성은
 * 지켜지고 있었지만(`assertNotInfoImage`·`rankReferenceImages`·
 * `PRODUCT_IDENTITY_RULES`), 그 규칙들이 "무엇이 이 제품의 정체성을
 * 증명하는 근거인가"를 하나의 이름 붙은 객체로 모아 두지는 않았다 — 이
 * 파일이 그 자리를 채운다.
 *
 * ## 역할 분리 (요청 사양 A)
 *
 * - **Identity Reference**: 실제 제품 본체·구성품 사진 — "이 제품이
 *   실제로 이렇게 생겼다"는 Ground Truth. 색·형태·재질·구성품을 판단하는
 *   근거는 오직 이 사진들이다.
 * - **Scene/Style Reference**: 장면·분위기·연출 참고 — 이 파이프라인은
 *   아직 identity와 분리된 별도의 "장면/스타일 참조 사진" 자산을 갖고
 *   있지 않다(제품 원본 사진만 업로드되고, 장면은 항상 텍스트 지시로
 *   설명된다). 그래서 이 필드는 항상 빈 배열로 시작한다 — 있지도 않은
 *   자산을 지어내지 않는다. Scene reference 자산이 생기면(예: 사람이
 *   직접 고른 무드보드 이미지) 이 배열을 채우는 자리만 이미 마련해 둔다.
 *
 * ## 정보 출처 (요청 사양 A)
 *
 * 포장/라벨/OCR/사양표 이미지(`photoType: "INFO"`)는 이미 상위 계층
 * (`ImageGenService.assertNotInfoImage`, DB 조회 `photoType: "DESIGN"`
 * 필터)에서 후보 목록에 아예 들어오지 않는다 — 이 파일은 그 다음 단계,
 * 즉 "INFO가 아닌 후보 중 무엇이 identity 근거인가"만 정리한다. LLM 호출
 * 없음 — 순수 함수(결정적).
 */

export interface ProductIdentityReference {
  id: string;
  role: "primary_body" | "detail" | "component" | "reference";
  category: ImageCategory | null;
}

export interface ProductIdentityPack {
  /** 실제 제품 본체/구성품 사진 — Ground Truth. 우선순위 순으로 정렬됨 */
  identityReferences: ProductIdentityReference[];
  /**
   * 장면/스타일 참조 — 이 파이프라인에는 아직 identity와 분리된 별도
   * 자산이 없어 항상 빈 배열이다(위 설명 참고). 자리만 마련해 둔다.
   */
  sceneStyleReferences: string[];
  /** 이 제품에 대해 절대 바꾸면 안 되는 것 — Product Package에서 결정적으로 도출 */
  prohibitedVariations: string[];
  /** 이 pack이 어떤 우선순위 규칙을 따랐는지 사람이 읽을 수 있는 설명 */
  groundTruthNote: string;
}

const ROLE_BY_CATEGORY: Partial<Record<ImageCategory, ProductIdentityReference["role"]>> = {
  HERO: "primary_body",
  DETAIL: "detail",
  COMPONENTS: "component",
};

/** prohibitedVariations 목록이 무한정 길어지지 않게 두는 상한 */
const MAX_PROHIBITED_VARIATIONS = 6;

/**
 * Product Identity Pack을 만든다. `rankReferenceImages`가 이미 우선순위를
 * 매긴 실제(isReal) 참조 후보를 받아, identity reference로 재구성하고
 * Product Package 사실에서 "바꾸면 안 되는 것" 목록을 뽑는다.
 */
export function buildProductIdentityPack(
  productPackage: Pick<ProductPackage, "material" | "features" | "specifications">,
  rankedRealReferences: RankedReference[],
): ProductIdentityPack {
  const identityReferences: ProductIdentityReference[] = rankedRealReferences
    .filter((ref) => ref.isReal)
    .map((ref) => ({
      id: ref.id,
      role: (ref.category && ROLE_BY_CATEGORY[ref.category]) || "reference",
      category: ref.category,
    }));

  const prohibitedVariations: string[] = [];
  if (productPackage.material?.trim()) {
    prohibitedVariations.push(`재질을 다른 재질로 바꾸지 않는다 — 확인된 재질: ${productPackage.material.trim()}`);
  }
  for (const feature of productPackage.features) {
    if (prohibitedVariations.length >= MAX_PROHIBITED_VARIATIONS) break;
    if (/구성품?/.test(feature)) {
      prohibitedVariations.push(`구성품 구성을 새로 발명하지 않는다 — 확인된 사실: ${feature}`);
    }
  }
  for (const [key, value] of Object.entries(productPackage.specifications)) {
    if (prohibitedVariations.length >= MAX_PROHIBITED_VARIATIONS) break;
    prohibitedVariations.push(`규격을 변경하지 않는다 — ${key}: ${value}`);
  }
  prohibitedVariations.push(
    "제품의 형태·색상·구조·연결부를 실제 참조 사진과 다르게 그리지 않는다 — 확인되지 않은 디자인 변형을 추가하지 않는다",
  );

  return {
    identityReferences,
    sceneStyleReferences: [],
    prohibitedVariations: prohibitedVariations.slice(0, MAX_PROHIBITED_VARIATIONS + 1),
    groundTruthNote:
      "실제 제품 본체·구성품 사진(identityReferences)을 최우선 Ground Truth로 삼는다. " +
      "포장·라벨·OCR·사양표 이미지는 정보 확인용일 뿐 identity reference에서 이미 제외되어 있다 " +
      "(ImageGenService.assertNotInfoImage / photoType: DESIGN 필터).",
  };
}
