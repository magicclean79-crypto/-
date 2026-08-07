import type { DesignReviewResult } from "@acos/shared";

/**
 * 디자인 리뷰 응답 파서. (Sprint 35 — "시장 디자인 패턴 학습" CTO 지시)
 *
 * Gemini(또는 다른 멀티모달 Provider)가 상세페이지 스크린샷을 보고 내린
 * 평가를 `DesignReviewResult`로 해석한다. `DesignReviewResult` 자체는
 * `@acos/shared`에 있다 — ProductProfile과 같은 원칙(출력 계약은 shared,
 * core가 가져다 쓴다).
 *
 * 이 파서는 "평가"라는 성격상 ProductProfile 파서처럼 사실 필드를 엄격히
 * 지어내지 않는 것이 아니라, **평가자가 판단을 회피하지 않도록** 각
 * 서술형 필드에 최소 내용을 요구한다 — 전부 빈 문자열이면 평가를 안 한
 *것과 같다.
 */
export interface DesignReviewContext {
  /** 어떤 카테고리의 상세페이지인지 (예: "캠핑용품") */
  category: string;
  /** 참고 맥락 — 예: "이 화면은 Template V1 시안이다" */
  notes?: string;
  /** 첨부되는 스크린샷 수 */
  imageCount: number;
}

export type { DesignReviewResult };

/** LLM 응답을 DesignReviewResult로 해석할 수 없을 때 */
export class DesignReviewParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignReviewParseError";
  }
}

function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function sanitizeText(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "평가 없음";
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sanitizeScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * LLM 텍스트 응답 → DesignReviewResult 파서.
 *
 * JSON 객체를 찾지 못하거나 summary(총평)가 없으면 오류 — 총평 없는
 * 디자인 리뷰는 리뷰가 아니다. 나머지 서술형 필드는 비어 있으면
 * "평가 없음"으로 보정한다(지어내지 않되, 평가 자체를 누락한 필드는
 * 눈에 보이게 표시한다).
 */
export function parseDesignReviewResponse(text: string): DesignReviewResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new DesignReviewParseError("LLM 응답에서 JSON 객체를 찾을 수 없습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new DesignReviewParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DesignReviewParseError("LLM 응답이 JSON 객체 형태가 아닙니다.");
  }

  const record = parsed as Record<string, unknown>;
  const summary = sanitizeText(record.summary);
  if (summary === "평가 없음") {
    throw new DesignReviewParseError("디자인 리뷰에 summary(총평)가 없습니다.");
  }

  return {
    layout: sanitizeText(record.layout),
    typography: sanitizeText(record.typography),
    whitespace: sanitizeText(record.whitespace),
    imagePlacement: sanitizeText(record.imagePlacement),
    colorUsage: sanitizeText(record.colorUsage),
    visualHierarchy: sanitizeText(record.visualHierarchy),
    purchaseMotivation: sanitizeText(record.purchaseMotivation),
    mobileUx: sanitizeText(record.mobileUx),
    strengths: sanitizeStringArray(record.strengths),
    improvements: sanitizeStringArray(record.improvements),
    overallScore: sanitizeScore(record.overallScore),
    summary,
  };
}
