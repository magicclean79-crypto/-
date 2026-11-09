import type { ImageCategory } from "@acos/shared";

/**
 * Section Composition Asset — metadata 계약과 validation. (T1-149 요청
 * 사양 8 — "생성 asset metadata에 productId/sectionId/purpose/
 * referenceIds/version/artDirectionContractId를 저장하고 validation한다.
 * 다른 섹션 asset을 잘못 재사용할 수 없게 한다.")
 *
 * LLM 호출 없음 — 순수 함수. 이 파일은 "무엇이 이 asset에 붙어야 하는가"와
 * "그 metadata가 실제로 이 자리(카테고리·계약·제품)에 맞는가"만 판단한다
 * — 이미지 픽셀 내용 자체(구성품이 실제로 몇 개 그려졌는지 등)는 검사하지
 * 않는다. `docs/MASTER_GUIDE.md`의 "AI가 만든 것을 AI가 검사하면 검증이
 * 아니다" 원칙과 같은 이유로, 픽셀 판단은 사람의 몫으로 남긴다 — 이
 * validation은 구조적 배선(어느 섹션이 어느 계약·참조로 만들어졌는가)만
 * 기계적으로 확인한다.
 */

export interface SectionCompositionAssetMetadata {
  /** 이 asset이 속한 제품(이 파이프라인에서는 Product Profile 실행 id) */
  productId: string;
  /** 이 asset이 배정될 자리 — 지금 파이프라인에서는 ImageCategory가 곧 섹션 역할이다 */
  category: ImageCategory;
  /** 이 composition이 서사에서 하는 역할(사람이 읽을 수 있는 설명) */
  purpose: string;
  /** 이 asset을 만들 때 Gemini에 실제로 전달된 참조 이미지 id 목록 */
  referenceIds: string[];
  /** 같은 소스+카테고리 내 버전 번호 (기존 groupVersion과 동일 개념) */
  version: number;
  /** 이 asset을 만들 때 쓰인 Art Direction Contract id */
  artDirectionContractId: string;
  /**
   * 이 asset을 실제로 만든 이미지 생성 Provider (예: "openai", "gemini",
   * "mock"). (T1-150 — GPT Image 2 전환) Provider를 교체 가능하게 만든
   * 뒤에는 "무엇으로 만들었는지"가 곧 품질 비교의 근거가 된다 — asset마다
   * 남겨 두지 않으면 나중에 어느 생성물이 어느 Provider 것인지 되짚을 수
   * 없다.
   */
  provider: string;
  /** 이 asset을 만들 때 쓰인 실제 모델 id (예: "gpt-image-2", "gemini-2.5-flash-image") */
  model: string;
}

export interface AssetMetadataValidationContext {
  expectedProductId: string;
  expectedCategory: ImageCategory;
  expectedArtDirectionContractId: string;
  /** COMPONENTS처럼 "실제로 확인된 것만"을 요구하는 카테고리에서 true (요청 사양 14) */
  requireReferenceEvidence?: boolean;
}

export interface AssetMetadataValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * 이 asset이 실제로 그 productId/category/contract로 만들어졌는지,
 * 다른 섹션의 asset이 잘못 흘러 들어오지 않았는지 확인한다.
 */
export function validateSectionCompositionAssetMetadata(
  metadata: SectionCompositionAssetMetadata,
  context: AssetMetadataValidationContext,
): AssetMetadataValidationResult {
  const reasons: string[] = [];
  if (metadata.productId !== context.expectedProductId) {
    reasons.push(
      `productId 불일치 — 기대값 "${context.expectedProductId}", 실제 "${metadata.productId}" (다른 제품의 asset일 수 있음)`,
    );
  }
  if (metadata.category !== context.expectedCategory) {
    reasons.push(
      `category 불일치 — 기대값 "${context.expectedCategory}", 실제 "${metadata.category}" (다른 섹션의 asset일 수 있음)`,
    );
  }
  if (metadata.artDirectionContractId !== context.expectedArtDirectionContractId) {
    reasons.push(
      `artDirectionContractId 불일치 — 이 asset은 "${metadata.artDirectionContractId}" 계약으로 만들어졌으나 ` +
        `이 자리는 "${context.expectedArtDirectionContractId}" 계약을 기대한다`,
    );
  }
  if (context.requireReferenceEvidence && metadata.referenceIds.length === 0) {
    reasons.push("실제 참조 근거(referenceIds) 없이 만들어진 asset — 확인되지 않은 내용을 발명했을 위험");
  }
  if (!metadata.purpose.trim()) {
    reasons.push("purpose가 비어 있음 — 이 asset이 서사에서 하는 역할을 알 수 없음");
  }
  if (!metadata.provider.trim() || !metadata.model.trim()) {
    reasons.push("provider/model이 비어 있음 — 이 asset을 실제로 만든 생성 Provider를 알 수 없음");
  }
  return { valid: reasons.length === 0, reasons };
}
