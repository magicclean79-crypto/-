import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@acos/shared";

/**
 * 인증/권한 Foundation 도메인 로직. (TASK-0801, Sprint 8)
 *
 * - 비밀번호 해시: Node 내장 scrypt (외부 의존성 없음, salt 개별 생성)
 * - 세션 토큰: 256비트 난수 (DB 저장형 세션 — 만료는 저장소가 관리)
 * - RBAC: 역할 계층 ADMIN > EDITOR > VIEWER
 * 자세한 구조: docs/architecture/auth.md
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N (2^14)

/** 세션 유효 기간 (기본 7일) */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 비밀번호 최소 길이 */
export const PASSWORD_MIN_LENGTH = 8;

function scryptAsync(
  password: string,
  salt: string,
  cost: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N: cost }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** 비밀번호 → 저장용 해시 ("scrypt:<N>:<salt>:<hash>") */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, SCRYPT_COST);
  return `scrypt:${SCRYPT_COST}:${salt}:${key.toString("hex")}`;
}

/** 저장 해시 대조 (상수 시간 비교) */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, costText, salt, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !costText || !salt || !hashHex) {
    return false;
  }
  const cost = Number(costText);
  if (!Number.isInteger(cost) || cost < 2) {
    return false;
  }
  const key = await scryptAsync(password, salt, cost);
  const expected = Buffer.from(hashHex, "hex");
  return (
    key.length === expected.length && timingSafeEqual(key, expected)
  );
}

/** 세션 토큰 — 256비트 난수 hex */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

const ROLE_LEVEL: Record<UserRole, number> = {
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

/** RBAC — role이 required 이상의 권한인지 (계층 비교) */
export function roleAtLeast(role: UserRole, required: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}
