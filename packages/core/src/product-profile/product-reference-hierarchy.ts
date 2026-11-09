import type { ImageCategory } from "@acos/shared";

/**
 * 실제 제품 reference hierarchy. (T1-149)
 *
 * Gemini에 "이 제품이 이렇게 생겼다"고 알려주는 참조 사진에는 우선순위가
 * 있어야 한다 — 요청 사양: "본체/노즐/스텐 주름 호스/확인된 구성품을
 * 우선한다. 포장/라벨/OCR/사양표는 제외한다."
 *
 * 포장·라벨·OCR·사양표(`photoType: "INFO"`) 제외는 이미 상위 계층에서
 * 끝나 있다 — `ImageGenService.assertNotInfoImage`(모든 Gemini 호출
 * 진입점)와 DB 조회 시 `photoType: "DESIGN"` 필터(`generateImageCandidates`)
 * 가 그 사진을 아예 후보 목록에 올리지 않는다. 이 파일은 그 다음 단계 —
 * "INFO가 아닌 후보들 중에서도 무엇을 먼저 참조하게 할 것인가"를 정한다.
 * LLM 호출 없음 — 순수 함수(결정적).
 */

export interface ReferenceCandidate {
  id: string;
  /** 이 사진이 상세페이지에서 어떤 역할로 이미 검증됐는지(사람이 지정한 카테고리) — 없으면 null */
  category: ImageCategory | null;
  /** 실제 업로드 원본(또는 그 crop)인지 — Gemini가 만든 파생 이미지가 아닌지 */
  isReal: boolean;
  /** 정렬 안정성을 위한 2차 기준(예: 업로드 시각의 epoch ms) */
  order: number;
}

export interface RankedReference extends ReferenceCandidate {
  priority: number;
  reason: string;
}

/**
 * 카테고리별 우선순위 — 낮을수록 먼저 참조한다. 본체(HERO)·클로즈업/호스
 * (DETAIL)·검증된 구성품(COMPONENTS) 순으로 우선하고, 나머지 카테고리는
 * 그 다음이다(요청 사양이 명시한 순서 그대로).
 */
const CATEGORY_PRIORITY: Partial<Record<ImageCategory, number>> = {
  HERO: 0,
  DETAIL: 1,
  COMPONENTS: 2,
};

/**
 * 실제 원본(또는 crop) 사진을 카테고리 우선순위로, 그 다음 생성형
 * 이미지를 뒤로 정렬한다. 같은 우선순위 안에서는 `order`(보통 업로드
 * 시각)로 안정 정렬한다.
 */
export function rankReferenceImages(candidates: ReferenceCandidate[]): RankedReference[] {
  return candidates
    .map((candidate): RankedReference => {
      if (candidate.isReal && candidate.category && CATEGORY_PRIORITY[candidate.category] !== undefined) {
        return {
          ...candidate,
          priority: CATEGORY_PRIORITY[candidate.category]!,
          reason: `실제 원본 사진 + ${candidate.category}로 검증됨 — 본체/디테일/구성품 우선 순위`,
        };
      }
      if (candidate.isReal) {
        return { ...candidate, priority: 3, reason: "실제 원본 사진(카테고리 미지정)" };
      }
      return { ...candidate, priority: 4, reason: "생성형 이미지 — 참조 우선순위 낮음" };
    })
    .sort((a, b) => a.priority - b.priority || a.order - b.order);
}
