import {
  DEFAULT_JOB_RETRY_POLICY,
  jobRetryDelayMs,
  planJobRetry,
  resolveJobRetryPolicy,
} from "./retry-plan";

describe("planJobRetry (TASK-4603)", () => {
  it("일시적인 실패는 다시 시도한다", () => {
    const decision = planJobRetry(Object.assign(new Error("x"), { status: 503 }), 1);
    expect(decision.retry).toBe(true);
    expect(decision.delayMs).toBe(2_000);
    expect(decision.reason).toContain("2번째");
  });

  it("회차마다 대기가 길어지되 상한을 넘지 않는다", () => {
    expect(jobRetryDelayMs(1)).toBe(2_000);
    expect(jobRetryDelayMs(2)).toBe(4_000);
    expect(jobRetryDelayMs(9)).toBe(DEFAULT_JOB_RETRY_POLICY.maxDelayMs);
  });

  /**
   * 돈이 나가는 호출을 네 번 하면 한 번의 사용자 행동이 네 배의 비용이 된다.
   */
  it("기본 최대 시도가 알림(4회)보다 적다", () => {
    expect(DEFAULT_JOB_RETRY_POLICY.maxAttempts).toBe(3);
    const decision = planJobRetry(Object.assign(new Error("x"), { status: 503 }), 3);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("실패 비용이 실패 횟수만큼");
  });

  it("되돌릴 수 없는 실패는 시도하지 않는다", () => {
    const decision = planJobRetry(Object.assign(new Error("x"), { status: 400 }), 1);
    expect(decision.retry).toBe(false);
    expect(decision.verdict.kind).toBe("rejected");
  });

  /**
   * 정책은 기다린다고 바뀌지 않는다.
   */
  it("정책으로 막힌 것은 시도하지 않고 그 이유를 말한다", () => {
    const decision = planJobRetry(new Error("예산을 초과해 차단했습니다"), 1);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("기다린다고 열리지 않으므로");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const error of [new Error("x"), Object.assign(new Error("y"), { status: 500 })]) {
      expect(planJobRetry(error, 1).reason).not.toContain("**");
    }
  });
});

describe("resolveJobRetryPolicy (TASK-4603)", () => {
  it("선언이 없으면 기본값이다", () => {
    const { policy, rejected } = resolveJobRetryPolicy({});
    expect(policy).toEqual(DEFAULT_JOB_RETRY_POLICY);
    expect(rejected).toEqual([]);
  });

  it("선언을 읽는다", () => {
    const { policy } = resolveJobRetryPolicy({ JOB_RETRY_MAX_ATTEMPTS: "2" });
    expect(policy.maxAttempts).toBe(2);
  });

  /**
   * 조용히 되돌리면 "바꿨다고 믿는데 안 바뀐" 상태가 된다 (4601-③과 같은 규칙).
   */
  it("읽을 수 없는 선언은 기본값으로 되돌리되 돌려준다", () => {
    const { policy, rejected } = resolveJobRetryPolicy({
      JOB_RETRY_MAX_ATTEMPTS: "많이",
      JOB_RETRY_BASE_DELAY_MS: "-5",
    });
    expect(policy).toEqual(DEFAULT_JOB_RETRY_POLICY);
    expect(rejected).toEqual(["JOB_RETRY_MAX_ATTEMPTS=많이", "JOB_RETRY_BASE_DELAY_MS=-5"]);
  });

  /**
   * 상한이 없으면 누군가 100회를 적고, 그 비용은 사고가 난 뒤에 안다.
   */
  it("최대 시도에 상한을 둔다", () => {
    const { policy, rejected } = resolveJobRetryPolicy({ JOB_RETRY_MAX_ATTEMPTS: "50" });
    expect(policy.maxAttempts).toBe(DEFAULT_JOB_RETRY_POLICY.maxAttempts);
    expect(rejected).toHaveLength(1);
  });
});
