import type { ProductPageCopy, ProductProfile } from "@acos/shared";

/**
 * 상세페이지 카피(대표 문구 + 제품 설명) 프롬프트 컨텍스트 및 응답 파서.
 * (Sprint 35 Phase 2 — Product Detail Engine STEP 5의 첫 단계)
 *
 * "product-page-copy" 템플릿(Prompt Engine)의 입력/출력. STEP 4가 만든
 * Product Profile만 근거로 삼는다 — 이미지를 다시 첨부하지 않는다(STEP 4와
 * 같은 원칙: 이미지 판단은 STEP 3이 이미 끝냈다). `ProductPageCopy` 자체는
 * `@acos/shared`에 있다 — ImageFeatureAnalysis/ProductProfile과 같은 원칙.
 */
export interface ProductPageCopyContext {
  profile: ProductProfile;
  /**
   * 사용자 요구사항 기반 생성 (T1-92) — 있으면 카피의 어조·강조점에
   * 반영하되, `profile`의 사실과 충돌하면 무시한다(프롬프트 규칙).
   */
  userRequirement?: string | null;
}

export type { ProductPageCopy };

/** LLM 응답을 ProductPageCopy로 해석할 수 없을 때 */
export class ProductPageCopyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductPageCopyParseError";
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

function sanitizeRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * LLM 텍스트 응답 → ProductPageCopy 파서.
 *
 * headline·description 둘 다 없으면 안 되는 필수 필드다(상세페이지의
 * 최소 골격) — 없으면 ProductPageCopyParseError. Product Profile에 이미
 * 없는 사실을 지어내지 말라는 규칙은 프롬프트가 강제하고, 여기서는 형식만
 * 확인한다.
 */
export function parseProductPageCopyResponse(text: string): ProductPageCopy {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new ProductPageCopyParseError(
      "LLM 응답에서 JSON 객체를 찾을 수 없습니다.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new ProductPageCopyParseError("LLM 응답의 JSON 파싱에 실패했습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProductPageCopyParseError("LLM 응답이 JSON 객체 형태가 아닙니다.");
  }

  const record = parsed as Record<string, unknown>;
  const headline = sanitizeRequiredString(record.headline);
  const description = sanitizeRequiredString(record.description);
  if (!headline || !description) {
    throw new ProductPageCopyParseError(
      "상세페이지 카피에 headline 또는 description이 없습니다.",
    );
  }

  return { headline, description };
}
