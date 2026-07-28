/** 클라이언트 인증 보관 키 (TASK-0801) — 토큰은 localStorage에 저장 */
export const AUTH_TOKEN_KEY = "acos_token";
export const AUTH_USER_KEY = "acos_user";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/** 보호 API 호출용 헤더 (TASK-0802 — 모든 쓰기 API 인증) */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 인증 fetch 옵션 (TASK-0804) — Bearer 헤더(개발 localStorage)와
 * httpOnly 쿠키 전송(credentials, 운영 쿠키 전용 모드)을 함께 지원한다.
 */
export function authFetchInit(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    credentials: "include",
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...authHeaders(),
    },
  };
}
