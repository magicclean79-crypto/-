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
