/**
 * 로그인 Rate Limit 도메인 로직. (TASK-0804, Sprint 8)
 *
 * 키(예: 이메일)별 슬라이딩 윈도우로 시도 횟수를 제한한다.
 * 인메모리 단일 인스턴스 전제 — 다중 인스턴스 운영 시 공유 저장소로
 * 교체가 필요하다(기술 부채로 기록). 계정 잠금(Account Lockout)은
 * DB 기반으로 별도 처리한다 — Rate Limit은 프로세스 재시작 시 초기화되는
 * 1차 방어선이다.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** 윈도우 안에 남은 허용 횟수 (거부 시 0) */
  remaining: number;
  /** 거부 시 재시도까지 남은 밀리초 (허용 시 0) */
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 시도 1회를 기록하고 허용 여부를 반환한다 */
  attempt(key: string, now: number = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter(
      (time) => time > cutoff,
    );
    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: recent[0] + this.windowMs - now,
      };
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterMs: 0,
    };
  }

  /** 키의 기록 제거 (성공 로그인 후 등) */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  clear(): void {
    this.attempts.clear();
  }
}
