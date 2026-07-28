/** 클라이언트 인증 보관 키 (TASK-0801) — 토큰은 localStorage에 저장 */
export const AUTH_TOKEN_KEY = "acos_token";
export const AUTH_USER_KEY = "acos_user";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(AUTH_TOKEN_KEY);
}
