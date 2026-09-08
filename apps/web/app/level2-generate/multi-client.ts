import { authFetchInit } from "../../lib/auth-client";

/**
 * LEVEL 2 다중 상세페이지 생성(T1-191) 전용 클라이언트. 업로드는
 * `apps/web/app/level1/level1-client.ts`(T1-188)·
 * `apps/web/app/level1-generate/one-shot-client.ts`(T1-189)와 API
 * 경로는 같지만, 이 파일 자체는 새로 둔다 — 기존 두 화면을 수정하지
 * 않는다.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class MultiApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MultiApiError";
    this.status = status;
  }
}

function extractErrorMessage(body: unknown, status: number): string {
  const message = (body as { message?: string | string[] } | null)?.message;
  if (Array.isArray(message)) return message.join(", ");
  if (typeof message === "string" && message) return message;
  return `요청 실패 (HTTP ${status})`;
}

/**
 * API가 죽지 않고 응답만 멈춘 경우(연결은 되지만 끝나지 않는 요청) 브라우저
 * fetch에는 기본 타임아웃이 없어 화면이 "불러오는 중…" 상태로 무한 대기할
 * 수 있었다(T1-201). 20초로 끊어 반드시 에러 상태로 넘어가게 한다.
 */
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { ...authFetchInit(init), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new MultiApiError(`서버 응답이 없습니다 (${REQUEST_TIMEOUT_MS / 1000}초 초과)`);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new MultiApiError(`서버에 연결할 수 없습니다: ${detail}`);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new MultiApiError(extractErrorMessage(body, response.status), response.status);
  }
  return body as T;
}

export interface Level1ProjectDto {
  id: string;
  name: string;
}

export interface Level1ProductDto {
  id: string;
  projectId: string;
}

export interface VerifiedProductFacts {
  name: string | null;
  brand: string | null;
  model: string | null;
  manufacturer: string | null;
  originCountry: string | null;
  materials: string[];
  dimensions: string | null;
  includedComponents: string[];
  specs: Record<string, string>;
  cautions: string[];
}

export interface Level1DetailPageDto {
  id: string;
  pageIndex: number;
  pageRole: string;
  title: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  provider: string | null;
  model: string | null;
  referenceAssetIds: string[];
  /** 이 섹션이 무엇을 보여주는지 사람이 읽는 설명(T1-196) */
  sectionDescription: string | null;
  /** sectionDescription의 근거가 된 사진(시각 reference + OCR로 정보가 확인된 사진, T1-196) */
  evidenceAssetIds: string[];
  /** sectionDescription 신뢰도 — 코드가 계산한 값(T1-196) */
  descriptionConfidence: number | null;
  outputObjectKey: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DesignTemplateId = "commercial-editorial" | "technical-commerce" | "minimal-product";

export interface DesignTokens {
  templateId: DesignTemplateId;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentSoft: string;
  headingScale: { hero: string; h2: string; h3: string; label: string };
  bodyScale: { base: string; small: string };
  maxWidth: string;
  sectionSpacing: { mobile: string; desktop: string };
  imageRadius: string;
  imageTreatment: "natural" | "flush" | "framed";
  grid: { benefitColumns: number; detailColumns: number };
  dividerStyle: string;
  fontHeading: string;
  fontBody: string;
}

export interface DesignSelectionDto {
  templateId: DesignTemplateId;
  tokens: DesignTokens;
  reason: string;
}

export interface ProductFactsProvenanceDto {
  method: "vision-analysis";
  provider: string | null;
  model: string | null;
  analyzedAssetIds: string[];
  actualProductAssetIds: string[];
}

/** 업로드 사진 1장의 OCR 실행 요약(T1-196) — 원문 전체를 그대로 담는다. */
export interface Level1AssetOcrSummaryDto {
  assetId: string;
  provider: string | null;
  status: "SUCCESS" | "FAILED" | "PENDING" | "RUNNING" | null;
  extractedText: string | null;
  confidence: number | null;
  boundingBoxCount: number;
  error: string | null;
}

export type FieldVerificationStatus = "single-source" | "agreed" | "conflict" | "unknown";

export interface FieldVerificationDto {
  field: string;
  observations: { source: string; value: string }[];
  status: FieldVerificationStatus;
  resolvedValue: string | null;
}

export interface Level1MultiGenerationDto {
  id: string;
  productId: string;
  status: "PENDING" | "ANALYZING" | "GENERATING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  analysisProvider: string | null;
  analysisModel: string | null;
  verifiedProductFacts: VerifiedProductFacts | null;
  designSystem: DesignSelectionDto;
  productFactsProvenance: ProductFactsProvenanceDto | null;
  /** 업로드된 사진 전체의 OCR 실행 결과(T1-196) */
  ocrResults: Level1AssetOcrSummaryDto[];
  /** OCR 원문 ↔ Gemini Vision 분석 교차 검증 결과(T1-196) */
  factsVerification: FieldVerificationDto[];
  errorMessage: string | null;
  pages: Level1DetailPageDto[];
  createdAt: string;
  updatedAt: string;
}

export function createMultiProject(name: string): Promise<Level1ProjectDto> {
  return request<Level1ProjectDto>("/level1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function createMultiProduct(projectId: string): Promise<Level1ProductDto> {
  return request<Level1ProductDto>(`/level1/projects/${projectId}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function uploadMultiAsset(productId: string, file: File): Promise<unknown> {
  const formData = new FormData();
  formData.append("file", file);
  return request(`/level1/products/${productId}/assets`, {
    method: "POST",
    body: formData,
  });
}

export function startMultiGeneration(productId: string): Promise<Level1MultiGenerationDto> {
  return request<Level1MultiGenerationDto>(`/level1/products/${productId}/multi-generate`, {
    method: "POST",
  });
}

export function fetchMultiGeneration(generationId: string): Promise<Level1MultiGenerationDto> {
  return request<Level1MultiGenerationDto>(`/level1/multi-generations/${generationId}`);
}

export async function fetchPageImageUrl(pageId: string): Promise<string> {
  const url = `${API_URL}/level1/multi-generations/pages/${pageId}/file`;
  let response: Response;
  try {
    response = await fetch(url, { ...authFetchInit(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new MultiApiError(`페이지 이미지를 불러올 수 없습니다: ${detail}`);
  }
  if (!response.ok) {
    throw new MultiApiError(`페이지 이미지를 불러올 수 없습니다 (HTTP ${response.status})`, response.status);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * 원본 업로드 사진(가공되지 않은 실제 제품 사진) 원본 바이트를 그대로
 * 가져온다(T1-197 HERO/GALLERY — Gemini 생성물이 아니라 원본을 그대로
 * 보여줘야 하는 자리에 쓴다). 기존 `level1.controller.ts`의
 * `GET assets/:id/file`(T1-188, 읽기 전용 · 이번 작업이 수정하지 않음)을
 * 재사용한다.
 */
export async function fetchAssetImageUrl(assetId: string): Promise<string> {
  const url = `${API_URL}/level1/assets/${assetId}/file`;
  let response: Response;
  try {
    response = await fetch(url, { ...authFetchInit(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new MultiApiError(`원본 사진을 불러올 수 없습니다: ${detail}`);
  }
  if (!response.ok) {
    throw new MultiApiError(`원본 사진을 불러올 수 없습니다 (HTTP ${response.status})`, response.status);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
