import type { ImageFeatureAnalysis, ProductProfile } from "@acos/shared";

/**
 * Product Profile 통합. (TASK-5601, Sprint 35 — Product Detail Engine V1
 * STEP 4, CTO 지시 "Sprint 35 Phase 1")
 *
 * OCR 텍스트 + 이미지 특징 분석(STEP 3)을 하나의 상세페이지 재료 JSON으로
 * 합친다. "product-profile-synthesis" 템플릿(Prompt Engine)의 입력/출력.
 * 이 단계는 텍스트 추론만 하고 이미지를 다시 보지 않는다 — 이미지 판단은
 * STEP 3(ImageFeatureAnalysis)이 이미 했고, 여기서 다시 보면 같은 사실에
 * 두 개의 답이 생길 수 있다. `ProductProfile` 자체는 `@acos/shared`에
 * 있다 — VisionSummary/ProductAnalysis와 같은 원칙.
 */
export interface ProductProfileSynthesisContext {
  /** 참고용 OCR 텍스트 */
  ocrTexts: string[];
  /** STEP 3 결과 — 이미지에서 직접 확인한 특징 */
  imageFeatures: ImageFeatureAnalysis;
  imageCount: number;
}

export type { ProductProfile };

/** LLM 응답을 ProductProfile로 해석할 수 없을 때 */
export class ProductProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductProfileParseError";
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

function sanitizeStringArray(value: unknown): string[] {
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

function sanitizeSpecifications(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const specifications: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      specifications[key] = String(item);
    }
  }
  return specifications;
}

function sanitizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * LLM 텍스트 응답 → ProductProfile 파서.
 *
 * - JSON 객체를 찾지 못하거나 productName이 없으면 ProductProfileParseError
 * - 나머지 필드는 형식만 검증해 안전한 기본값으로 보정한다(배열 [] ·
 *   specifications {} · confidence 0~1 클램프) — "모른다"를 지어내지 않는다
 */
export function parseProductProfileResponse(text: string): ProductProfile {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new ProductProfileParseError(
      "LLM 응답에서 JSON 객체를 찾을 수 없습니다.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new ProductProfileParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProductProfileParseError(
      "LLM 응답이 JSON 객체 형태가 아닙니다.",
    );
  }

  const record = parsed as Record<string, unknown>;
  const productName = sanitizeNullableString(record.productName);
  if (!productName) {
    throw new ProductProfileParseError(
      "Product Profile에 productName이 없습니다.",
    );
  }

  return {
    productName,
    brand: sanitizeNullableString(record.brand),
    model: sanitizeNullableString(record.model),
    material: sanitizeNullableString(record.material),
    features: sanitizeStringArray(record.features),
    specifications: sanitizeSpecifications(record.specifications),
    usage: sanitizeNullableString(record.usage),
    advantages: sanitizeStringArray(record.advantages),
    warnings: sanitizeStringArray(record.warnings),
    keywords: sanitizeStringArray(record.keywords),
    confidence: sanitizeConfidence(record.confidence),
  };
}
