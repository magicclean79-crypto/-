import { GoogleGenAI } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { buildAnalysisPrompt } from "./multi-page-prompt";
import {
  EMPTY_VERIFIED_PRODUCT_FACTS,
  MAX_PAGES,
  MIN_PAGES,
  type AnalysisResult,
  type AssetRoleClassification,
  type ClassifiedAssetRole,
  type PagePlanItem,
  type VerifiedProductFacts,
} from "./multi-page-types";

/**
 * 분석 호출(Call A) 기본 모델 — `apps/api/src/llm/providers/gemini.provider.ts`의
 * `DEFAULT_MODEL`("gemini-2.5-flash")과 동일한, 이 저장소가 이미 실제
 * 운영 중인 Gemini 텍스트/JSON 모드 모델을 그대로 재사용한다(추측이
 * 아니다). 그 파일 자체는 수정하지 않는다 — 이 모듈은 완전히 독립된
 * 클라이언트를 새로 둔다.
 */
export const GEMINI_ANALYSIS_DEFAULT_MODEL = "gemini-2.5-flash";

export class GeminiAnalysisError extends Error {
  constructor(
    message: string,
    readonly finishReason?: string,
  ) {
    super(message);
    this.name = "GeminiAnalysisError";
  }
}

export interface GeminiAnalysisImageInput {
  base64: string;
  mimeType: string;
}

export interface GeminiAnalysisClient {
  models: {
    generateContent: (params: GenerateContentParameters) => Promise<GenerateContentResponse>;
  };
}

export interface GeminiAnalysisCallResult {
  model: string;
  rawText: string;
  result: AnalysisResult;
}

const VALID_ROLES: ClassifiedAssetRole[] = [
  "ACTUAL_PRODUCT",
  "PACKAGING",
  "LABEL",
  "SPEC",
  "BARCODE",
  "MANUAL",
  "LIFESTYLE",
  "UNKNOWN",
];

function coerceStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function coerceStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim().length > 0) out[key] = raw;
  }
  return out;
}

/** 모델이 JSON 스키마를 완벽히 지키지 않을 수 있어, 값을 하나씩 방어적으로 정제한다. */
function parseVerifiedProductFacts(raw: unknown): VerifiedProductFacts {
  if (!raw || typeof raw !== "object") return { ...EMPTY_VERIFIED_PRODUCT_FACTS };
  const r = raw as Record<string, unknown>;
  return {
    name: coerceStringOrNull(r.name),
    brand: coerceStringOrNull(r.brand),
    model: coerceStringOrNull(r.model),
    manufacturer: coerceStringOrNull(r.manufacturer),
    originCountry: coerceStringOrNull(r.originCountry),
    materials: coerceStringArray(r.materials),
    dimensions: coerceStringOrNull(r.dimensions),
    includedComponents: coerceStringArray(r.includedComponents),
    specs: coerceStringRecord(r.specs),
    cautions: coerceStringArray(r.cautions),
  };
}

function parseAssetRoles(raw: unknown, assetCount: number): AssetRoleClassification[] {
  if (!Array.isArray(raw)) return [];
  const out: AssetRoleClassification[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const assetIndex = typeof entry.assetIndex === "number" ? entry.assetIndex : null;
    const role = typeof entry.role === "string" ? entry.role : null;
    if (
      assetIndex === null ||
      assetIndex < 0 ||
      assetIndex >= assetCount ||
      !role ||
      !VALID_ROLES.includes(role as ClassifiedAssetRole)
    ) {
      continue;
    }
    out.push({ assetIndex, role: role as ClassifiedAssetRole });
  }
  return out;
}

/**
 * 모델이 sectionDescription을 빠뜨리면 이 자리를 채운다 — **제품 정보를
 * 지어내지 않는다**는 요청 사양을 여기서도 지켜야 하므로, 역할 이름에서
 * 나오는 일반적인 문구만 쓰고 구체적인 사실(소재·수치 등)은 넣지 않는다
 * (`ensureMandatoryPagePlan`의 fallback과 같은 보수적 원칙).
 */
export function fallbackSectionDescription(pageRole: string, title: string): string {
  return `${title || pageRole} — 이 섹션의 이미지를 보여줍니다.`;
}

function parsePagePlan(raw: unknown): PagePlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PagePlanItem[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const entry = item as Record<string, unknown>;
    const pageIndex = typeof entry.pageIndex === "number" ? entry.pageIndex : i + 1;
    const pageRole =
      typeof entry.pageRole === "string" && entry.pageRole.trim()
        ? entry.pageRole.trim().toUpperCase()
        : "FEATURES";
    const title = typeof entry.title === "string" && entry.title.trim() ? entry.title : `페이지 ${pageIndex}`;
    const designBrief = typeof entry.designBrief === "string" ? entry.designBrief : "";
    const sectionDescription =
      typeof entry.sectionDescription === "string" && entry.sectionDescription.trim()
        ? entry.sectionDescription.trim()
        : fallbackSectionDescription(pageRole, title);
    out.push({ pageIndex, pageRole, title, designBrief, sectionDescription });
  });
  // 페이지 수 상한/하한은 모델이 지키지 않을 수 있어 코드로도 강제한다.
  return out.slice(0, MAX_PAGES);
}

/**
 * LEVEL 2 분석 호출(Call A) 어댑터 (T1-191).
 *
 * `@google/genai`의 `models.generateContent` + `responseMimeType:
 * "application/json"` 조합은 이미 `apps/api/src/llm/providers/
 * gemini.provider.ts`(TASK-0903)가 운영 코드에서 실제로 쓰고 있는
 * 검증된 형태다 — 이 조합을 이미지 출력(`responseModalities:
 * [Modality.IMAGE]`, T1-189)과 같은 호출에 섞어 쓰는 것은 문서·코드
 * 어디에서도 검증되지 않아 새로 추측하지 않는다. 그래서 분석(텍스트
 * JSON)과 이미지 생성을 **별도 호출**로 분리한다 — 이것이 "API 한계가
 * 있으면 가장 단순한 최소 호출 구조를 쓴다"는 요청에 대한 이 작업의
 * 답이다(상세: LEVEL2_MULTI_PAGE_GENERATION.md).
 */
export class GeminiAnalysisGenerator {
  private readonly client: GeminiAnalysisClient;
  readonly model: string;

  constructor(options: { apiKey: string; model?: string; client?: GeminiAnalysisClient }) {
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? GEMINI_ANALYSIS_DEFAULT_MODEL;
  }

  async analyze(images: GeminiAnalysisImageInput[]): Promise<GeminiAnalysisCallResult> {
    const prompt = buildAnalysisPrompt(images.length);
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
      ...images.map((image) => ({
        inlineData: { mimeType: image.mimeType, data: image.base64 },
      })),
      { text: prompt },
    ];

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json" },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    const rawText = response.text ?? "";
    if (!rawText) {
      throw new GeminiAnalysisError(
        `Gemini가 분석 결과를 반환하지 않았습니다 (finishReason: ${finishReason ?? "unknown"})`,
        finishReason,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new GeminiAnalysisError(
        `Gemini 분석 응답이 유효한 JSON이 아닙니다 (앞 300자: ${rawText.slice(0, 300)})`,
        finishReason,
      );
    }

    const record = (parsed ?? {}) as Record<string, unknown>;
    const verifiedProductFacts = parseVerifiedProductFacts(record.verifiedProductFacts);
    const assetRoles = parseAssetRoles(record.assetRoles, images.length);
    const pagePlan = parsePagePlan(record.pagePlan);

    if (pagePlan.length < MIN_PAGES) {
      throw new GeminiAnalysisError(
        `Gemini가 유효한 페이지 구성을 ${MIN_PAGES}장 미만으로 반환했습니다 (실제: ${pagePlan.length}장)`,
        finishReason,
      );
    }

    return {
      model: response.modelVersion ?? this.model,
      rawText,
      result: { verifiedProductFacts, assetRoles, pagePlan },
    };
  }
}
