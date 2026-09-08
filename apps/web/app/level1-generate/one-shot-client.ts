import { authFetchInit } from "../../lib/auth-client";

/**
 * LEVEL1 원샷 생성(T1-189) 전용 클라이언트. 업로드/생성 호출은 이 파일
 * 안에서만 하고, `apps/web/app/level1/level1-client.ts`(T1-188, 동시
 * 진행 중)는 수정하지 않는다 — 새 화면이라 API_URL만 같은 방식으로
 * 다시 읽는다.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class OneShotApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OneShotApiError";
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
    throw new OneShotApiError(`서버에 연결할 수 없습니다: ${detail}`);
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
    throw new OneShotApiError(extractErrorMessage(body, response.status), response.status);
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

export interface Level1GenerationDto {
  id: string;
  productId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  provider: string;
  model: string;
  promptText: string;
  referenceAssetIds: string[];
  outputObjectKey: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createOneShotProject(name: string): Promise<Level1ProjectDto> {
  return request<Level1ProjectDto>("/level1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function createOneShotProduct(projectId: string): Promise<Level1ProductDto> {
  return request<Level1ProductDto>(`/level1/projects/${projectId}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function uploadOneShotAsset(productId: string, file: File): Promise<unknown> {
  const formData = new FormData();
  formData.append("file", file);
  return request(`/level1/products/${productId}/assets`, {
    method: "POST",
    body: formData,
  });
}

export function generateOneShotDetailPage(productId: string): Promise<Level1GenerationDto> {
  return request<Level1GenerationDto>(`/level1/products/${productId}/generate`, {
    method: "POST",
  });
}

export async function fetchGenerationImageUrl(generationId: string): Promise<string> {
  const url = `${API_URL}/level1/generations/${generationId}/file`;
  const response = await fetch(url, authFetchInit());
  if (!response.ok) {
    throw new OneShotApiError(`결과 이미지를 불러올 수 없습니다 (HTTP ${response.status})`, response.status);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
