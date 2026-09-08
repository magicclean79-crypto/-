/**
 * OCR 후보 ↔ Gemini Vision 분석(verifiedProductFacts) 교차 검증 (T1-196).
 *
 * `packages/core/src/product-profile/cross-verification.ts`(T1-23)와 같은
 * 패턴이다 — 출처가 하나면 그 값을 쓰고, 둘 이상인데 값이 다르면 **자동으로
 * 고르지 않고** conflict로 남긴다. level1-multi는 다른 작업과 충돌을
 * 피하려 core 모듈을 직접 import하지 않고 이 파일 안에서 같은 패턴을
 * 다시 구현한다(multi-page-types.ts 헤더 주석과 같은 이유) — 대상 필드
 * 집합이 `VerifiedProductFacts`로 달라 그대로 재사용할 수도 없다.
 */

export type FieldVerificationStatus = "single-source" | "agreed" | "conflict" | "unknown";

export interface FieldObservation {
  /** "vision-analysis" 또는 "ocr:<assetId>" */
  source: string;
  value: string;
}

export interface FieldVerification {
  field: string;
  observations: FieldObservation[];
  status: FieldVerificationStatus;
  /** conflict면 항상 null — 어느 쪽이 맞는지는 사람이 판단한다. */
  resolvedValue: string | null;
}

/** 공백·괄호·구두점 차이를 흡수해 "같은 값"인지 비교한다. */
function normalize(value: string): string {
  return value.replace(/[\s()（）,·.]/g, "").toLowerCase();
}

function verifyOneField(field: string, observations: FieldObservation[]): FieldVerification {
  const withValue = observations.filter((o) => o.value.trim().length > 0);
  if (withValue.length === 0) {
    return { field, observations: [], status: "unknown", resolvedValue: null };
  }
  if (withValue.length === 1) {
    return {
      field,
      observations: withValue,
      status: "single-source",
      resolvedValue: withValue[0].value,
    };
  }
  const distinctNormalized = new Set(withValue.map((o) => normalize(o.value)));
  if (distinctNormalized.size === 1) {
    return { field, observations: withValue, status: "agreed", resolvedValue: withValue[0].value };
  }
  return { field, observations: withValue, status: "conflict", resolvedValue: null };
}

/**
 * 필드별 관측값 묶음을 받아 교차 검증 결과를 만든다.
 * 입력이 없는 필드는 결과에서 제외한다(있는 필드만 다룬다).
 */
export function verifyFields(
  observationsByField: Record<string, FieldObservation[]>,
): FieldVerification[] {
  return Object.entries(observationsByField)
    .filter(([, observations]) => observations.length > 0)
    .map(([field, observations]) => verifyOneField(field, observations));
}
