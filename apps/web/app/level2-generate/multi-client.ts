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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, authFetchInit(init));
  } catch (err) {
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
  outputObjectKey: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFactsProvenanceDto {
  method: "vision-analysis";
  provider: string | null;
  model: string | null;
  analyzedAssetIds: string[];
  actualProductAssetIds: string[];
}

export interface Level1MultiGenerationDto {
  id: string;
  productId: string;
  status: "PENDING" | "ANALYZING" | "GENERATING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  analysisProvider: string | null;
  analysisModel: string | null;
  verifiedProductFacts: VerifiedProductFacts | null;
  productFactsProvenance: ProductFactsProvenanceDto | null;
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
  const response = await fetch(url, authFetchInit());
  if (!response.ok) {
    throw new MultiApiError(`페이지 이미지를 불러올 수 없습니다 (HTTP ${response.status})`, response.status);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
