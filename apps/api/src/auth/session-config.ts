import {
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "@acos/core";
import type { SessionCookieOptions } from "@acos/core";

/**
 * 세션/운영 보안 환경 설정. (TASK-0803 · TASK-0804, Sprint 8)
 *
 * - AUTH_COOKIE_SECURE=1: 쿠키에 Secure 부여 (운영 HTTPS 필수)
 * - AUTH_COOKIE_SAMESITE=lax|strict|none: SameSite (기본 lax,
 *   none은 브라우저 규칙상 Secure 강제 — core에서 처리)
 * - AUTH_PROTECT_HEALTH=1|0: /llm/health 보호 명시 지정.
 *   미지정 시 NODE_ENV가 production/staging이면 보호 (CTO 결정 0802-③)
 * - AUTH_COOKIE_ONLY=1|0: 쿠키 전용 모드 — 로그인 응답에서 토큰 제외.
 *   미지정 시 운영/스테이징이면 켜짐 (CTO 결정 0803-①: 운영은 쿠키 전용)
 * - AUTH_SESSION_TTL_HOURS: 세션 수명(시간, 기본 168=7일) — Session Timeout
 * - AUTH_LOGIN_MAX_ATTEMPTS / AUTH_LOGIN_WINDOW_SEC: 로그인 Rate Limit
 *   (기본 30회/60초, 이메일 키 슬라이딩 윈도우 → 429)
 * - AUTH_LOCKOUT_THRESHOLD / AUTH_LOCKOUT_MINUTES: 계정 잠금
 *   (기본 연속 5회 실패 시 15분 잠금 — DB 기반)
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

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isOperationalEnv(): boolean {
  return ["production", "staging"].includes(process.env.NODE_ENV ?? "");
}

/** 세션 수명 (TASK-0804 Session Timeout) — 기본 7일, 시간 단위 환경변수 */
export function sessionTtlMs(): number {
  const hours = process.env.AUTH_SESSION_TTL_HOURS;
  if (hours === undefined) {
    return SESSION_TTL_MS;
  }
  return envInt(hours, Math.floor(SESSION_TTL_MS / 3_600_000)) * 3_600_000;
}

/** 쿠키 전용 모드 (TASK-0804 — CTO 결정 0803-①: 운영은 쿠키 전용) */
export function isCookieOnly(): boolean {
  return envFlag(process.env.AUTH_COOKIE_ONLY) ?? isOperationalEnv();
}

/** 로그인 Rate Limit 설정 (TASK-0804) */
export function loginRateLimitConfig(): { limit: number; windowMs: number } {
  return {
    limit: envInt(process.env.AUTH_LOGIN_MAX_ATTEMPTS, 30),
    windowMs: envInt(process.env.AUTH_LOGIN_WINDOW_SEC, 60) * 1000,
  };
}

/** 계정 잠금 설정 (TASK-0804) */
export function lockoutConfig(): { threshold: number; lockMs: number } {
  return {
    threshold: envInt(process.env.AUTH_LOCKOUT_THRESHOLD, 5),
    lockMs: envInt(process.env.AUTH_LOCKOUT_MINUTES, 15) * 60_000,
  };
}

/**
 * 환경변수 → 세션 쿠키 옵션 (수명은 세션 TTL과 동일).
 *
 * ## `Secure`는 운영·스테이징에서 **자동으로 켜집니다** (TASK-4801)
 *
 * v1.0 점검에서 잡은 것: `ENV_SPECS`의 `AUTH_COOKIE_SECURE` 선언은
 * **"운영에서는 자동 활성"** 이라고 적혀 있는데, 이 함수는 `?? false`
 * 였습니다. **선언과 코드가 서로 다른 말을 하고 있었습니다.**
 *
 * 그리고 그 차이는 조용했습니다 — 미설정일 때 환경 검증이 경고조차 내지
 * 않았습니다(경고는 명시적 `0`에만 반응했습니다). 즉 운영에 올린 사람은
 * 선언을 읽고 "켜져 있겠지"라고 믿을 근거가 있었고, 확인할 방법은
 * 없었습니다.
 *
 * 운영은 **쿠키 전용 모드가 기본**입니다(`isCookieOnly`). 그러면 세션
 * 쿠키가 **유일한 자격 증명**이고, `Secure`가 없으면 그 자격 증명이 평문
 * 경로로 나갈 수 있습니다.
 *
 * HTTP로만 서비스하는 환경(내부망 스테이징 등)은 `AUTH_COOKIE_SECURE=0`을
 * **명시**해야 합니다 — 그때는 환경 검증이 경고로 그 사실을 말합니다.
 * 끄는 것은 되지만 **모르는 채로 꺼져 있는 것**은 안 됩니다.
 */
export function sessionCookieOptions(): SessionCookieOptions {
  const raw = (process.env.AUTH_COOKIE_SAMESITE ?? "lax").toLowerCase();
  return {
    secure: envFlag(process.env.AUTH_COOKIE_SECURE) ?? isOperationalEnv(),
    sameSite: raw === "strict" ? "Strict" : raw === "none" ? "None" : "Lax",
    maxAgeSeconds: Math.floor(sessionTtlMs() / 1000),
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
