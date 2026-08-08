import type { ImageFeatureAnalysis, PhotoType } from "@acos/shared";

/**
 * 이미지 특징 분석 프롬프트 컨텍스트 및 응답 파서. (TASK-5601, Sprint 35 —
 * Product Detail Engine V1 STEP 3)
 *
 * "product-feature-vision" 템플릿(Prompt Engine)의 입력/출력. 이미지
 * 바이트는 프롬프트 텍스트가 아니라 LLM Gateway 요청의 images(멀티모달
 * 첨부)로 전달된다 — vision-analysis와 같은 원칙(TASK-0505).
 *
 * 기존 VisionSummary(labels/brand/category/suggestedTitle)와는 목적이
 * 다르다 — 여기서는 재질·색상·구조·용도·구성품처럼 **상세페이지 본문에
 * 바로 쓸 수 있는 특징**을 뽑는다. 기존 Vision 파이프라인(ProductObject
 * 조립용)은 그대로 두고 병행한다. `ImageFeatureAnalysis` 자체는
 * `@acos/shared`에 있다 — VisionSummary/ProductAnalysis와 같은 원칙(출력
 * 계약은 shared에 두고 core가 가져다 쓴다).
 */
export interface ImageFeatureAnalysisContext {
  /** 참고용 OCR 텍스트 (있으면 정확도 향상에 사용) */
  ocrTexts: string[];
  /** LLM 요청에 첨부되는 이미지 수 */
  imageCount: number;
}

export type { ImageFeatureAnalysis };

/** LLM 응답을 ImageFeatureAnalysis로 해석할 수 없을 때 */
export class ImageFeatureParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFeatureParseError";
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

function sanitizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

/** 길이가 imageCount와 다르거나 값이 이상해도 항상 imageCount 길이의 배열을 돌려준다 —
 * 판단이 애매하면 DESIGN으로 둔다(잘못 폐기하는 것보다 안전한 쪽). */
function sanitizePhotoTypes(value: unknown, imageCount: number): PhotoType[] {
  const raw = Array.isArray(value) ? value : [];
  return Array.from({ length: imageCount }, (_, i) => (raw[i] === "INFO" ? "INFO" : "DESIGN"));
}

/**
 * LLM 텍스트 응답 → ImageFeatureAnalysis 파서.
 *
 * JSON 객체를 찾지 못하면 ImageFeatureParseError. 나머지 필드는 전부
 * 선택값이라 형식만 안전하게 보정한다 — 이미지에서 확인되지 않은 특징을
 * 지어내지 않는다는 것이 이 파서가 아니라 프롬프트의 규칙이므로, 여기서는
 * "모델이 null이라고 답한 것"과 "형식이 깨진 것"만 가른다.
 */
export function parseImageFeatureAnalysisResponse(
  text: string,
  imageCount: number,
): ImageFeatureAnalysis {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new ImageFeatureParseError(
      "LLM 응답에서 JSON 객체를 찾을 수 없습니다.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new ImageFeatureParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ImageFeatureParseError("LLM 응답이 JSON 객체 형태가 아닙니다.");
  }

  const record = parsed as Record<string, unknown>;
  return {
    material: sanitizeNullableString(record.material),
    color: sanitizeNullableString(record.color),
    structure: sanitizeNullableString(record.structure),
    usage: sanitizeNullableString(record.usage),
    components: sanitizeStringArray(record.components),
    notes: sanitizeNullableString(record.notes),
    confidence: sanitizeConfidence(record.confidence),
    photoTypes: sanitizePhotoTypes(record.photoTypes, imageCount),
  };
}
