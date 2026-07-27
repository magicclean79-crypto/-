import type { ProductObjectStatus } from "@acos/shared";

/**
 * Product Object 상태 전이 규칙 (TASK-0302).
 *
 *   DRAFT ⇄ READY,  DRAFT → ARCHIVED,  READY → ARCHIVED,  ARCHIVED = 종결
 */
export const PRODUCT_OBJECT_TRANSITIONS: Record<
  ProductObjectStatus,
  ProductObjectStatus[]
> = {
  DRAFT: ["READY", "ARCHIVED"],
  READY: ["DRAFT", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionProductObject(
  from: ProductObjectStatus,
  to: ProductObjectStatus,
): boolean {
  return PRODUCT_OBJECT_TRANSITIONS[from].includes(to);
}

/** READY 전환 시 필수 조건 검증 입력 */
export interface ReadyValidationInput {
  title: string;
  ocrSummary: unknown | null;
  visionSummary: unknown | null;
}

/**
 * READY(검수 완료) 전환 필수 조건.
 * 위반 사항 목록을 반환한다 — 빈 배열이면 전환 가능.
 */
export function validateReadyRequirements(
  input: ReadyValidationInput,
): string[] {
  const errors: string[] = [];
  if (!input.title.trim()) {
    errors.push("제목이 비어 있습니다.");
  }
  if (!input.ocrSummary && !input.visionSummary) {
    errors.push("OCR 요약 또는 Vision 요약 중 하나 이상이 필요합니다.");
  }
  return errors;
}
