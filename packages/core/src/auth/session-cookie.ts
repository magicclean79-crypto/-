/**
 * 세션 쿠키 도메인 로직. (TASK-0803, Sprint 8)
 *
 * CTO 결정(0801 승인 ③): 개발은 localStorage Bearer 유지, 운영 전환 시
 * httpOnly · Secure · SameSite 쿠키 사용. 로그인 시 httpOnly 쿠키를 함께
 * 발급하고, 서버는 Bearer 헤더 → 쿠키 순으로 토큰을 인식한다.
 * 자세한 구조: docs/architecture/auth.md
 */

/** 세션 쿠키 이름 — httpOnly라 JS에서 접근 불가 (XSS 토큰 탈취 방지) */
export const SESSION_COOKIE_NAME = "acos_session";

export const SESSION_COOKIE_SAMESITE_VALUES = [
  "Lax",
  "Strict",
  "None",
] as const;

export type SessionCookieSameSite =
  (typeof SESSION_COOKIE_SAMESITE_VALUES)[number];

export interface SessionCookieOptions {
  /** Secure 속성 — HTTPS 전용 전송 (운영 필수) */
  secure: boolean;
  /** SameSite 속성 — 기본 Lax. None은 브라우저 규칙상 Secure를 강제한다 */
  sameSite: SessionCookieSameSite;
  /** 쿠키 수명(초) — 세션 TTL과 일치시킨다 */
  maxAgeSeconds: number;
}

/**
 * 로그인 시 발급할 Set-Cookie 값.
 * HttpOnly는 항상 켜지며, SameSite=None이면 Secure를 강제한다
 * (브라우저가 None+비Secure 쿠키를 거부하므로 잘못된 조합을 도메인에서 차단).
 */
export function buildSessionCookie(
  token: string,
  options: SessionCookieOptions,
): string {
  const secure = options.secure || options.sameSite === "None";
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `SameSite=${options.sameSite}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/** 로그아웃 시 쿠키 즉시 만료용 Set-Cookie 값 */
export function buildSessionClearCookie(
  options: Pick<SessionCookieOptions, "secure" | "sameSite">,
): string {
  return buildSessionCookie("", { ...options, maxAgeSeconds: 0 });
}

/** Cookie 요청 헤더 → { 이름: 값 } (없거나 형식 불량은 빈 객체) */
export function parseCookieHeader(
  header: string | undefined | null,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}
