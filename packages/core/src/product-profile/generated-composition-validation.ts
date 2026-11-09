/**
 * 생성된 Composition 사후 검증 결과 파서. (T1-153)
 *
 * `generated-composition-validation.template.ts`가 만든 프롬프트에 대한
 * LLM 응답을 구조로 해석한다 — 파싱 자체는 순수 함수, LLM 호출 없음.
 * 응답을 해석할 수 없으면 "검증 불가"로 표시할 뿐 통과로 처리하지
 * 않는다(모르는 것을 통과시키지 않는다는 기존 원칙과 동일).
 */

export interface GeneratedCompositionValidationResult {
  /** 이 응답을 구조로 해석할 수 있었는가 — false면 아래 필드는 보수적 기본값(위반 있음으로 간주) */
  parsed: boolean;
  containsVisibleText: boolean;
  textFound: string[];
  identityMismatch: boolean;
  mismatchNotes: string[];
  /** containsVisibleText도 identityMismatch도 없을 때만 true */
  ok: boolean;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function parseGeneratedCompositionValidationResponse(text: string): GeneratedCompositionValidationResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      parsed: false,
      containsVisibleText: true,
      textFound: [],
      identityMismatch: true,
      mismatchNotes: ["검증 응답에서 JSON을 찾을 수 없어 보수적으로 위반으로 간주함"],
      ok: false,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      parsed: false,
      containsVisibleText: true,
      textFound: [],
      identityMismatch: true,
      mismatchNotes: ["검증 응답 JSON 파싱 실패로 보수적으로 위반으로 간주함"],
      ok: false,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      parsed: false,
      containsVisibleText: true,
      textFound: [],
      identityMismatch: true,
      mismatchNotes: ["검증 응답이 JSON 객체가 아니어서 보수적으로 위반으로 간주함"],
      ok: false,
    };
  }
  const record = parsed as Record<string, unknown>;
  const containsVisibleText = record.containsVisibleText === true;
  const identityMismatch = record.identityMismatch === true;
  return {
    parsed: true,
    containsVisibleText,
    textFound: asStringArray(record.textFound),
    identityMismatch,
    mismatchNotes: asStringArray(record.mismatchNotes),
    ok: !containsVisibleText && !identityMismatch,
  };
}
