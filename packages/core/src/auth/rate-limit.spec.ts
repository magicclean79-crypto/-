import { SlidingWindowRateLimiter } from "./rate-limit";

describe("로그인 Rate Limiter (TASK-0804)", () => {
  it("윈도우 안에서 limit 초과 시 거부하고 재시도 시간을 알려준다", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    const t0 = 1_000_000;

    expect(limiter.attempt("a@x", t0).allowed).toBe(true);
    expect(limiter.attempt("a@x", t0 + 1000).allowed).toBe(true);
    const third = limiter.attempt("a@x", t0 + 2000);
    expect(third).toMatchObject({ allowed: true, remaining: 0 });

    const denied = limiter.attempt("a@x", t0 + 3000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(t0 + 60_000 - (t0 + 3000));

    // 다른 키는 독립
    expect(limiter.attempt("b@x", t0 + 3000).allowed).toBe(true);
  });

  it("윈도우가 지나면 다시 허용하고, reset은 즉시 초기화한다", () => {
    const limiter = new SlidingWindowRateLimiter(2, 10_000);
    const t0 = 0;
    limiter.attempt("a@x", t0);
    limiter.attempt("a@x", t0 + 1);
    expect(limiter.attempt("a@x", t0 + 2).allowed).toBe(false);

    // 첫 시도가 윈도우를 벗어나면 허용
    expect(limiter.attempt("a@x", t0 + 10_001).allowed).toBe(true);

    limiter.reset("a@x");
    expect(limiter.attempt("a@x", t0 + 10_002).allowed).toBe(true);
  });
});
