import { authFetchInit } from "../../lib/auth-client";

/** Image Studio의 모든 컴포넌트가 공유하는 API baseURL (T1-119) */
export const IMAGE_STUDIO_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const IS_DEV = process.env.NODE_ENV !== "production";

export type ImageStudioApiErrorKind = "network" | "http" | "parse";

/**
 * Image Studio API 호출 실패를 원인별로 구분한다 (T1-119) — 화면은
 * "Failed to fetch"라는 브라우저 원문을 그대로 보여주지 않고 항상
 * `message`(사람이 읽는 안내)만 쓰면 된다. 원인을 구분해야 하면
 * `kind`("network"=서버 연결 자체가 안 됨: CORS·오프라인·서버 다운,
 * "http"=서버가 오류 상태로 응답, "parse"=응답을 JSON으로 해석하지
 * 못함)와 `status`(http일 때만)를 본다.
 */
export class ImageStudioApiError extends Error {
  readonly kind: ImageStudioApiErrorKind;
  readonly status?: number;

  constructor(message: string, kind: ImageStudioApiErrorKind, status?: number) {
    super(message);
    this.name = "ImageStudioApiError";
    this.kind = kind;
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
 * Image Studio의 모든 API 호출이 공유하는 fetch 래퍼 (T1-119). baseURL·
 * 인증 헤더(authFetchInit)·오류 메시지 추출 방식을 한 곳에 모아, 패널마다
 * 같은 로직을 따로 구현하며 생기던 미묘한 차이(예: 어떤 패널은 네트워크
 * 오류를 못 잡아 처리되지 않은 Promise 거부로 남던 문제, T1-113의
 * "Product Story Failed to fetch"와 같은 종류)를 구조적으로 막는다.
 *
 * 개발환경에서는 실패 시 원인을 항상 console.error로 남긴다 — 화면에
 * "불러오기 실패"만 뜨고 원인을 코드에서 찾아야 했던 문제(AuthImage,
 * T1-114와 같은 문제의식)를 API 호출 쪽에도 동일하게 적용한다.
 */
export async function imageStudioFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${IMAGE_STUDIO_API_URL}${path}`;
  const method = init.method ?? "GET";

  let response: Response;
  try {
    response = await fetch(url, authFetchInit(init));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (IS_DEV) {
      console.error(`[image-studio] 네트워크 오류: ${method} ${url} — ${detail}`);
    }
    throw new ImageStudioApiError(
      "서버에 연결할 수 없습니다 (네트워크 또는 CORS 문제) — 개발자 콘솔을 확인하세요.",
      "network",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    if (response.ok) {
      // 정상 응답인데 본문이 JSON이 아닌 경우(예: 빈 본문) — 호출자가 T로 다룬다
      return undefined as T;
    }
    const detail = err instanceof Error ? err.message : String(err);
    if (IS_DEV) {
      console.error(`[image-studio] 응답 파싱 실패: ${method} ${url} — HTTP ${response.status} — ${detail}`);
    }
    throw new ImageStudioApiError(
      `요청 실패 (HTTP ${response.status}) — 서버 응답을 해석하지 못했습니다.`,
      "parse",
      response.status,
    );
  }

  if (!response.ok) {
    const message = extractErrorMessage(body, response.status);
    if (IS_DEV) {
      console.error(`[image-studio] API 오류: ${method} ${url} — HTTP ${response.status} — ${message}`);
    }
    throw new ImageStudioApiError(message, "http", response.status);
  }

  return body as T;
}
