import {
  planResends,
  resendNotice,
  RESEND_BACKOFF_MS,
  RESEND_GIVE_UP_MS,
  RESEND_MAX_ROUNDS,
  type FailedDelivery,
} from "./resend-policy";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const MINUTE = 60_000;

function failure(overrides: Partial<FailedDelivery> = {}): FailedDelivery {
  return {
    id: overrides.id ?? "d1",
    alertKey: overrides.alertKey ?? "provider-failure:openai",
    channel: overrides.channel ?? "slack",
    level: overrides.level ?? "critical",
    lastAttemptAt: overrides.lastAttemptAt ?? NOW - 30 * MINUTE,
    firstAttemptAt: overrides.firstAttemptAt ?? NOW - 30 * MINUTE,
    status: overrides.status === undefined ? null : overrides.status,
    rounds: overrides.rounds ?? 0,
  };
}

describe("planResends (TASK-4601, 정책 4601-④)", () => {
  it("대기 시간이 지나면 다시 보낸다", () => {
    const plan = planResends({ failures: [failure()], now: NOW });
    expect(plan.resend).toHaveLength(1);
    expect(plan.items[0].round).toBe(1);
  });

  it("대기 중이면 언제 다시 볼지 말한다", () => {
    const plan = planResends({
      failures: [failure({ lastAttemptAt: NOW - MINUTE })],
      now: NOW,
    });
    expect(plan.items[0].decision).toBe("wait");
    expect(plan.items[0].dueAt).toBe(NOW - MINUTE + RESEND_BACKOFF_MS[0]);
  });

  it("회차가 올라가면 대기가 길어진다", () => {
    const plan = planResends({
      failures: [failure({ rounds: 1, lastAttemptAt: NOW - 20 * MINUTE })],
      now: NOW,
    });
    // 1회차를 마쳤으므로 다음 대기는 1시간 — 20분으로는 아직이다
    expect(plan.items[0].decision).toBe("wait");
  });

  /**
   * 재시도에서 이미 정한 판단을 여기서 뒤집지 않는다 — 잘못된 URL은
   * 4시간 뒤에도 잘못된 URL이다.
   */
  it("되돌릴 수 없는 실패는 다시 보내지 않는다", () => {
    const plan = planResends({ failures: [failure({ status: 404 })], now: NOW });
    expect(plan.items[0].decision).toBe("permanent");
    expect(plan.resend).toHaveLength(0);
  });

  it("429와 5xx는 다시 보낸다 — 일시적인 실패다", () => {
    for (const status of [429, 500, 503]) {
      const plan = planResends({ failures: [failure({ status })], now: NOW });
      expect(plan.items[0].decision).toBe("resend");
    }
  });

  /**
   * 끝난 일로 사람을 깨우는 것은 알림을 끄게 만드는 가장 빠른 길이다.
   */
  it("그 사이에 해소된 경보는 다시 보내지 않는다", () => {
    const plan = planResends({
      failures: [failure()],
      resolvedKeys: new Set(["provider-failure:openai"]),
      now: NOW,
    });
    expect(plan.items[0].decision).toBe("resolved");
    expect(plan.detail).toContain("해소돼");
  });

  /**
   * 무한 재전송은 죽은 채널에 영원히 매달린다 — 다만 조용히 그만두면
   * 아무도 못 받은 알림이 없는 일이 된다.
   */
  it("상한에 닿으면 멈추되 포기했다고 말한다", () => {
    const plan = planResends({
      failures: [failure({ rounds: RESEND_MAX_ROUNDS })],
      now: NOW,
    });
    expect(plan.items[0].decision).toBe("exhausted");
    expect(plan.givenUp).toHaveLength(1);
    expect(plan.detail).toContain("사라진 것이 아니라");
  });

  /**
   * 하루 지난 경보를 다시 보내면 그건 알림이 아니라 기록이다.
   */
  it("하루가 지나면 더 보내지 않는다", () => {
    const plan = planResends({
      failures: [
        failure({
          firstAttemptAt: NOW - RESEND_GIVE_UP_MS - MINUTE,
          lastAttemptAt: NOW - 5 * 60 * MINUTE,
        }),
      ],
      now: NOW,
    });
    expect(plan.items[0].decision).toBe("stale");
  });

  it("보낼 것이 없으면 없다고 말한다", () => {
    const plan = planResends({ failures: [], now: NOW });
    expect(plan.resend).toEqual([]);
    expect(plan.detail).toContain("없습니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const plan = planResends({
      failures: [
        failure({ id: "a" }),
        failure({ id: "b", status: 404 }),
        failure({ id: "c", rounds: RESEND_MAX_ROUNDS }),
      ],
      now: NOW,
    });
    expect(plan.detail).not.toContain("**");
    for (const item of plan.items) {
      expect(item.detail).not.toContain("**");
    }
  });
});

describe("resendNotice (TASK-4601)", () => {
  /**
   * 몇 번째인지 안 적으면 받는 사람은 같은 알림이 여러 번 온 것으로 읽고,
   * 그러면 한 장애를 여러 장애로 착각한다.
   */
  it("몇 번째 재전송인지와 새 문제가 아님을 적는다", () => {
    const notice = resendNotice(2, NOW - 90 * MINUTE, NOW);
    expect(notice).toContain(`재전송 2/${RESEND_MAX_ROUNDS}`);
    expect(notice).toContain("새로 생긴 문제가 아닙니다");
    expect(notice).not.toContain("**");
  });
});
