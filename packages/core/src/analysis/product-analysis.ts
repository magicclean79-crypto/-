import type { ProductAnalysis } from "@acos/shared";

/**
 * 상품 분석 프롬프트 컨텍스트. (TASK-0504, Sprint 5 — AI Execution)
 *
 * "product-analysis" 템플릿(Prompt Engine)의 입력으로,
 * 상품/OCR 정보와 Company Brain 컨텍스트를 담는다.
 */
export interface ProductAnalysisContext {
  product: {
    name: string;
    description: string | null;
  };
  /** 각 이미지의 최신 OCR 성공 텍스트 */
  ocrTexts: string[];
  imageCount: number;
  /** Company Brain 컨텍스트 — 상품 이름 기준 조회 결과 */
  companyBrain: {
    knowledge: { title: string; content: string; category: string | null }[];
    decisions: { title: string; reason: string }[];
    memories: { key: string; value: unknown; description: string | null }[];
  };
}

export const DRAFT_ANALYSIS_FALLBACK_NAME = "이름 미상 상품";
export const DRAFT_ANALYSIS_CATEGORY = "미분류";
export const DRAFT_ANALYSIS_CONFIDENCE = 0.3;

/**
 * 규칙 기반 초안 분석 — LLM에 검증·보강 대상으로 제시되는 결정적 초안.
 * (구 MockAnalysisProvider의 규칙을 계승 — OCR 첫 줄을 상품 이름으로 사용)
 * mock LLM은 이 초안을 그대로 반환하므로 오프라인에서도 파이프라인이 동작한다.
 */
export function buildDraftProductAnalysis(
  context: ProductAnalysisContext,
): ProductAnalysis {
  const ocrLines = context.ocrTexts
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstOcrLine = ocrLines[0];

  const productName = context.product.name.trim();
  const name = firstOcrLine ?? (productName || DRAFT_ANALYSIS_FALLBACK_NAME);

  const keywords = [
    ...new Set(
      name
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0)
        .slice(0, 5),
    ),
  ];

  const description =
    context.product.description?.trim() ||
    `${name} — OCR 텍스트 기반 초안 설명입니다.`;

  return {
    name,
    category: DRAFT_ANALYSIS_CATEGORY,
    keywords,
    description,
    attributes: {
      imageCount: String(context.imageCount),
      ocrTextCount: String(context.ocrTexts.length),
    },
    confidence: DRAFT_ANALYSIS_CONFIDENCE,
  };
}

/** LLM 응답을 ProductAnalysis로 해석할 수 없을 때 — 재시도 후 FAILED로 기록된다 */
export class AnalysisResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisResponseParseError";
  }
}

/** 코드 펜스·해설이 섞여 있어도 첫 "{"부터 마지막 "}"까지를 JSON 후보로 본다 */
function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function sanitizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function sanitizeAttributes(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const attributes: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      attributes[key] = String(item);
    }
  }
  return attributes;
}

function sanitizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * LLM 텍스트 응답 → ProductAnalysis 파서.
 *
 * - JSON 객체를 찾지 못하거나 name이 없으면 AnalysisResponseParseError
 * - 나머지 필드는 타입 검증 후 안전한 기본값으로 보정한다
 *   (category "미분류" · keywords [] · description "" · confidence 0.5 클램프)
 */
export function parseProductAnalysisResponse(text: string): ProductAnalysis {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new AnalysisResponseParseError(
      "LLM 응답에서 JSON 객체를 찾을 수 없습니다.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new AnalysisResponseParseError(
      "LLM 응답의 JSON 파싱에 실패했습니다.",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AnalysisResponseParseError(
      "LLM 응답이 JSON 객체 형태가 아닙니다.",
    );
  }

  const record = parsed as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.trim().length > 0
      ? record.name.trim()
      : null;
  if (!name) {
    throw new AnalysisResponseParseError(
      "LLM 분석 결과에 상품 이름(name)이 없습니다.",
    );
  }

  return {
    name,
    category:
      typeof record.category === "string" && record.category.trim().length > 0
        ? record.category.trim()
        : DRAFT_ANALYSIS_CATEGORY,
    keywords: sanitizeKeywords(record.keywords),
    description:
      typeof record.description === "string" ? record.description.trim() : "",
    attributes: sanitizeAttributes(record.attributes),
    confidence: sanitizeConfidence(record.confidence),
  };
}
