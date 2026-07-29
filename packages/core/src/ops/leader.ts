/**
 * Distributed Scheduler — Leader Election & Lock. (TASK-1401, Sprint 14)
 *
 * 다중 인스턴스에서 예약 점검이 **N번 실행되는 문제**를 없앤다
 * (TASK-1302에서 남긴 부채, CTO 결정 1302-②).
 *
 * 여기 있는 것은 **임차(lease) 판정의 순수 로직**뿐이다 — Redis 왕복은
 * api 어댑터가 한다. 분산 락은 시계와 만료가 얽혀 틀리기 쉬운 영역이라,
 * 판정만 떼어 내 시간을 흉내 내지 않고 테스트할 수 있게 했다.
 *
 * 설계 원칙:
 * - **임차는 반드시 만료된다.** 리더가 죽으면 락이 영원히 잠기는 것이
 *   가장 나쁜 실패다 — TTL 없는 락은 쓰지 않는다.
 * - **갱신은 만료 전에 미리 한다.** 만료 직전에 갱신하면 네트워크 지연
 *   한 번에 리더십을 잃는다 (기본: TTL의 1/3 지점).
 * - **소유자만 해제·갱신한다.** 남의 임차를 지우면 두 인스턴스가 동시에
 *   리더가 된다.
 */

/** 임차 1건 — 저장소(Redis)에 담기는 값 */
export interface Lease {
  /** 락 이름 (예: `scheduler:cost-verification`) */
  key: string;
  /** 소유자 식별자 — 인스턴스마다 다르다 */
  owner: string;
  /** 만료 시각 (epoch ms) */
  expiresAt: number;
}

export interface LeaseOptions {
  /** 임차 수명 (ms) */
  ttlMs: number;
  /** 갱신을 시도하는 시점 — 남은 수명이 이 값 이하이면 갱신 (기본 TTL의 2/3 경과) */
  renewAfterMs?: number;
}

export type LeaseDecision = "acquire" | "renew" | "hold" | "yield";

/** 기본 임차 수명 — 점검 주기보다 짧으면 매번 재선출이 일어난다 */
export const DEFAULT_LEASE_TTL_MS = 30_000;

/** 임차가 아직 유효한가 */
export function isLeaseValid(lease: Lease | null, now: number): boolean {
  return lease !== null && lease.expiresAt > now;
}

/** 갱신 시점 — 만료 직전이 아니라 여유를 두고 갱신한다 */
export function renewAfter(options: LeaseOptions): number {
  return options.renewAfterMs ?? Math.floor(options.ttlMs / 3);
}

/**
 * 지금 무엇을 해야 하는가.
 *
 * - `acquire` — 임차가 없거나 만료됨 → 잡으러 간다
 * - `renew` — 내 임차인데 곧 만료 → 미리 갱신한다
 * - `hold` — 내 임차이고 아직 여유 있음 → 아무것도 안 한다
 * - `yield` — 남의 유효한 임차 → 이번 주기는 넘긴다
 */
export function decideLease(
  lease: Lease | null,
  self: string,
  now: number,
  options: LeaseOptions,
): LeaseDecision {
  if (!isLeaseValid(lease, now)) {
    return "acquire";
  }
  if (lease!.owner !== self) {
    return "yield";
  }
  const remaining = lease!.expiresAt - now;
  return remaining <= renewAfter(options) ? "renew" : "hold";
}

/** 새 임차 값 (획득·갱신 공통) */
export function nextLease(
  key: string,
  owner: string,
  now: number,
  options: LeaseOptions,
): Lease {
  return { key, owner, expiresAt: now + options.ttlMs };
}

/**
 * 소유자 확인 — 해제·갱신 전에 반드시 통과해야 한다.
 * 남의 임차를 지우면 두 인스턴스가 동시에 리더가 된다.
 */
export function ownsLease(
  lease: Lease | null,
  self: string,
  now: number,
): boolean {
  return isLeaseValid(lease, now) && lease!.owner === self;
}

/**
 * 인스턴스 식별자 — 호스트명·PID·난수 조합.
 * 컨테이너에서는 호스트명이 겹칠 수 있어 난수를 섞는다.
 */
export function instanceId(parts: {
  hostname: string;
  pid: number;
  random: string;
}): string {
  return `${parts.hostname}-${parts.pid}-${parts.random}`;
}

/** 임차 상태 표시용 요약 */
export interface LeaseView {
  key: string;
  owner: string | null;
  /** 내가 리더인가 */
  self: boolean;
  expiresAt: string | null;
  /** 남은 수명 (ms) — 만료됐거나 없으면 0 */
  remainingMs: number;
}

export function describeLease(
  lease: Lease | null,
  self: string,
  now: number,
): LeaseView {
  const valid = isLeaseValid(lease, now);
  return {
    key: lease?.key ?? "",
    owner: valid ? lease!.owner : null,
    self: valid && lease!.owner === self,
    expiresAt: valid ? new Date(lease!.expiresAt).toISOString() : null,
    remainingMs: valid ? lease!.expiresAt - now : 0,
  };
}
