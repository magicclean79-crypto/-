import type { VisionSummary } from "@acos/shared";

/**
 * Vision 분석 프롬프트 컨텍스트. (TASK-0505, Sprint 5 — AI Execution)
 *
 * "vision-analysis" 템플릿(Prompt Engine)의 입력으로, 프로젝트/OCR 정보와
 * Company Brain 컨텍스트를 담는다. 이미지 바이트는 프롬프트 텍스트가 아니라
 * LLM Gateway 요청의 images(멀티모달 첨부)로 전달된다.
 */
export interface VisionAnalysisContext {
  project: {
    name: string;
    description: string | null;
  };
  /** 참고용 OCR 텍스트 */
  ocrTexts: string[];
  /** LLM 요청에 첨부되는 이미지 수 */
  imageCount: number;
  /** Company Brain 컨텍스트 — 프로젝트 이름 기준 조회 결과 */
  companyBrain: {
    knowledge: { title: string; content: string; category: string | null }[];
    decisions: { title: string; reason: string }[];
    memories: { key: string; value: unknown; description: string | null }[];
  };
}

/** LLM이 출력해야 하는 형태 — source는 Provider가 채운다 */
export type VisionSummaryDraft = Omit<VisionSummary, "source">;

export const DRAFT_VISION_CATEGORY = "미분류";
export const DRAFT_VISION_CONFIDENCE = 0.3;
export const DRAFT_VISION_FALLBACK_LABEL = "product";

/**
 * 규칙 기반 초안 Vision 요약 — LLM에 검증·보강 대상으로 제시되는 결정적 초안.
 * mock LLM은 이 초안을 그대로 반환하므로 오프라인에서도 파이프라인이 동작한다.
 */
export function buildDraftVisionSummary(
  context: VisionAnalysisContext,
): VisionSummaryDraft {
  const firstOcrLine = context.ocrTexts
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const projectName = context.project.name.trim();
  const labelSource = firstOcrLine ?? projectName;
  const labels = [
    ...new Set(
      labelSource
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0)
        .slice(0, 5),
    ),
  ];
  if (labels.length === 0) {
    labels.push(DRAFT_VISION_FALLBACK_LABEL);
  }

  return {
    labels,
    brand: null,
    category: DRAFT_VISION_CATEGORY,
    suggestedTitle: firstOcrLine ?? (projectName || null),
    confidence: DRAFT_VISION_CONFIDENCE,
  };
}

/** LLM 응답을 VisionSummary로 해석할 수 없을 때 — 호출자 재시도 후 null 폴백 */
export class VisionResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionResponseParseError";
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

function sanitizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function sanitizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * LLM 텍스트 응답 → VisionSummaryDraft 파서.
 *
 * - JSON 객체를 찾지 못하거나 labels가 비어 있으면 VisionResponseParseError
 * - 나머지 필드는 타입 검증 후 보정 (brand/category/suggestedTitle null ·
 *   confidence 0~1 클램프, 누락 시 0.5)
 */
export function parseVisionSummaryResponse(text: string): VisionSummaryDraft {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new VisionResponseParseError(
      "LLM 응답에서 JSON 객체를 찾을 수 없습니다.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new VisionResponseParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new VisionResponseParseError("LLM 응답이 JSON 객체 형태가 아닙니다.");
  }

  const record = parsed as Record<string, unknown>;
  const labels = Array.isArray(record.labels)
    ? [
        ...new Set(
          record.labels
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        ),
      ]
    : [];
  if (labels.length === 0) {
    throw new VisionResponseParseError(
      "Vision 분석 결과에 labels가 없습니다.",
    );
  }

  return {
    labels,
    brand: sanitizeNullableString(record.brand),
    category: sanitizeNullableString(record.category),
    suggestedTitle: sanitizeNullableString(record.suggestedTitle),
    confidence: sanitizeConfidence(record.confidence),
  };
}
