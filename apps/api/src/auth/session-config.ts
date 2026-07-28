import {
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "@acos/core";
import type { SessionCookieOptions } from "@acos/core";

/**
 * 세션/운영 보안 환경 설정. (TASK-0803, Sprint 8)
 *
 * - AUTH_COOKIE_SECURE=1: 쿠키에 Secure 부여 (운영 HTTPS 필수)
 * - AUTH_COOKIE_SAMESITE=lax|strict|none: SameSite (기본 lax,
 *   none은 브라우저 규칙상 Secure 강제 — core에서 처리)
 * - AUTH_PROTECT_HEALTH=1|0: /llm/health 보호 명시 지정.
 *   미지정 시 NODE_ENV가 production/staging이면 보호 (CTO 결정 0802-③)
 */

function envFlag(value: string | undefined): boolean | null {
  const normalized = (value ?? "").toLowerCase();
  if (["1", "true"].includes(normalized)) {
    return true;
  }
  if (["0", "false"].includes(normalized)) {
    return false;
  }
  return null;
}

/** 환경변수 → 세션 쿠키 옵션 (수명은 세션 TTL과 동일) */
export function sessionCookieOptions(): SessionCookieOptions {
  const raw = (process.env.AUTH_COOKIE_SAMESITE ?? "lax").toLowerCase();
  return {
    secure: envFlag(process.env.AUTH_COOKIE_SECURE) ?? false,
    sameSite: raw === "strict" ? "Strict" : raw === "none" ? "None" : "Lax",
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** 세션 토큰 추출 — Authorization: Bearer 우선, 없으면 httpOnly 쿠키 */
export function extractRequestToken(
  headers: Record<string, string | undefined>,
): string {
  const header = headers["authorization"] ?? "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7);
  }
  return parseCookieHeader(headers["cookie"])[SESSION_COOKIE_NAME] ?? "";
}

/**
 * /llm/health 보호 여부 (CTO 결정 0802-③) —
 * 운영/스테이징은 EDITOR 이상 인증 요구, 개발은 비보호 유지.
 */
export function isHealthProtected(): boolean {
  const explicit = envFlag(process.env.AUTH_PROTECT_HEALTH);
  if (explicit !== null) {
    return explicit;
  }
  return ["production", "staging"].includes(process.env.NODE_ENV ?? "");
}
