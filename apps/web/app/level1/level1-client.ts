import { authFetchInit } from "../../lib/auth-client";

/**
 * Product Detail Engine LEVEL 1 (T1-188)의 전용 API 클라이언트.
 * 기존 Image Studio(`apps/web/app/image-studio/api-client.ts`) 등 다른
 * 화면의 코드는 재사용하지 않는다 — Level1은 새 프로그램의 독립된 기반이다.
 */
export const LEVEL1_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class Level1ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "Level1ApiError";
    this.status = status;
  }
}

function extractErrorMessage(body: unknown, status: number): string {
  const message = (body as { message?: string | string[] } | null)?.message;
  if (Array.isArray(message)) return message.join(", ");
  if (typeof message === "string" && message) return message;
  return `요청 실패 (HTTP ${status})`;
}

export async function level1Fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${LEVEL1_API_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, authFetchInit(init));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Level1ApiError(`서버에 연결할 수 없습니다: ${detail}`);
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new Level1ApiError(extractErrorMessage(body, response.status), response.status);
  }
  return body as T;
}
