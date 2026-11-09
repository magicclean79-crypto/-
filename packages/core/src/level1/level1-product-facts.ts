import type { UpsertLevel1ProductRequest } from "@acos/shared";

/** {@link UpsertLevel1ProductRequest}에서 사람이 실제로 채울 수 있는 필드 이름 */
export const LEVEL1_PRODUCT_FACT_FIELDS = [
  "name",
  "brand",
  "model",
  "category",
  "materials",
  "colors",
  "dimensions",
  "includedComponents",
  "origin",
  "claims",
] as const;

export type Level1ProductFactField = (typeof LEVEL1_PRODUCT_FACT_FIELDS)[number];

export interface Level1ProductFactsValidation {
  ok: boolean;
  errors: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * 제품 사실 입력 검증 (T1-188 요청 사양 5) — **확인되지 않은 값을
 * 만들어내지 않는다**를 코드로 강제한다. 이 함수는 값을 추측해 채우지
 * 않고, 형태가 잘못된 입력만 걸러낸다(타입 오류·알 수 없는
 * uncertainFields 이름).
 */
export function validateLevel1ProductFacts(
  input: UpsertLevel1ProductRequest,
): Level1ProductFactsValidation {
  const errors: string[] = [];

  const stringFields: (keyof UpsertLevel1ProductRequest)[] = [
    "name",
    "brand",
    "model",
    "category",
    "dimensions",
    "origin",
    "notes",
  ];
  for (const field of stringFields) {
    const value = input[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      errors.push(`${field}는 문자열이어야 합니다.`);
    }
  }

  const arrayFields: (keyof UpsertLevel1ProductRequest)[] = [
    "materials",
    "colors",
    "includedComponents",
    "claims",
  ];
  for (const field of arrayFields) {
    const value = input[field];
    if (value !== undefined && !isStringArray(value)) {
      errors.push(`${field}는 문자열 배열이어야 합니다.`);
    }
  }

  if (input.uncertainFields !== undefined) {
    if (!isStringArray(input.uncertainFields)) {
      errors.push("uncertainFields는 문자열 배열이어야 합니다.");
    } else {
      const unknown = input.uncertainFields.filter(
        (field) => !(LEVEL1_PRODUCT_FACT_FIELDS as readonly string[]).includes(field),
      );
      if (unknown.length > 0) {
        errors.push(
          `uncertainFields에 알 수 없는 필드가 있습니다: ${unknown.join(", ")}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 빈 문자열을 null로, 배열의 빈 항목/중복 공백을 정리한다 — 값 자체는 지어내지 않는다 */
export function sanitizeLevel1ProductFacts(
  input: UpsertLevel1ProductRequest,
): UpsertLevel1ProductRequest {
  const sanitized: UpsertLevel1ProductRequest = { ...input };

  const stringFields: (keyof UpsertLevel1ProductRequest)[] = [
    "name",
    "brand",
    "model",
    "category",
    "dimensions",
    "origin",
    "notes",
  ];
  for (const field of stringFields) {
    const value = sanitized[field];
    if (typeof value === "string") {
      const trimmed = value.trim();
      (sanitized as Record<string, unknown>)[field] = trimmed.length > 0 ? trimmed : null;
    }
  }

  const arrayFields: (keyof UpsertLevel1ProductRequest)[] = [
    "materials",
    "colors",
    "includedComponents",
    "claims",
    "uncertainFields",
  ];
  for (const field of arrayFields) {
    const value = sanitized[field];
    if (Array.isArray(value)) {
      (sanitized as Record<string, unknown>)[field] = value
        .map((item) => (typeof item === "string" ? item.trim() : item))
        .filter((item) => typeof item === "string" && item.length > 0);
    }
  }

  return sanitized;
}
