import {
  judgeChannelReachability,
  REACHABILITY_WINDOW_MS,
  summarizeReachability,
  type DeliveryRecord,
} from "./delivery-health";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const HOUR = 3_600_000;

function delivery(
  overrides: Partial<DeliveryRecord> & { at: number },
): DeliveryRecord {
  return {
    channel: overrides.channel ?? "slack",
    ok: overrides.ok ?? true,
    at: overrides.at,
  };
}

describe("judgeChannelReachability (TASK-4601, 정책 4601-④)", () => {
  it("창 안에 성공이 있으면 도달로 본다", () => {
    const result = judgeChannelReachability({
      channel: "slack",
      enabled: true,
      deliveries: [delivery({ at: NOW - 2 * HOUR })],
      now: NOW,
    });
    expect(result.verdict).toBe("reached");
    expect(result.successes).toBe(1);
  });

  /**
   * 3주 전에 한 번 닿은 채널과 지금 닿는 채널이 같은 초록으로 보이면,
   * 만료된 웹훅 주소를 다음 장애 때 알게 된다.
   */
  it("창 밖의 성공은 도달로 세지 않는다", () => {
    const result = judgeChannelReachability({
      channel: "slack",
      enabled: true,
      deliveries: [delivery({ at: NOW - REACHABILITY_WINDOW_MS - HOUR })],
      now: NOW,
    });
    expect(result.verdict).not.toBe("reached");
    expect(result.successes).toBe(0);
  });

  /**
   * 조용한 것과 죽은 것은 다르다 — 장애가 없는 하루를 채널 실패로 칠하면
   * 그 경고가 배경 소음이 된다.
   */
  it("창 안에 시도가 없으면 실패가 아니라 '모른다'로 둔다", () => {
    const result = judgeChannelReachability({
      channel: "slack",
      enabled: true,
      deliveries: [delivery({ at: NOW - 3 * 24 * HOUR })],
      now: NOW,
    });
    expect(result.verdict).toBe("silent");
    expect(result.detail).toContain("가릴 수 없습니다");
  });

  /**
   * 모른다는 말만 하고 확인하는 방법을 안 적으면 그 칸은 영원히 회색이다.
   */
  it("모르는 칸에는 확인하는 방법을 적는다", () => {
    const result = judgeChannelReachability({
      channel: "slack",
      enabled: true,
      deliveries: [delivery({ at: NOW - 3 * 24 * HOUR })],
      now: NOW,
    });
    expect(result.next).toContain("/ops/notifications/test");
  });

  it("창 안 시도가 전부 실패면 지금 닿지 않는다고 말한다", () => {
    const result = judgeChannelReachability({
      channel: "slack",
      enabled: true,
      deliveries: [
        delivery({ at: NOW - HOUR, ok: false }),
        delivery({ at: NOW - 2 * HOUR, ok: false }),
      ],
      now: NOW,
    });
    expect(result.verdict).toBe("failing");
    expect(result.attempts).toBe(2);
    expect(result.next).toContain("아무것도 못 받고");
  });

  it("성공 기록이 아예 없으면 never다", () => {
    const result = judgeChannelReachability({
      channel: "teams",
      enabled: true,
      deliveries: [],
      now: NOW,
    });
    expect(result.verdict).toBe("never");
    expect(result.detail).toContain("다른 사실입니다");
  });

  /**
   * 안 쓰기로 한 채널을 실패로 칠하면, 채널을 줄인 환경이 나빠 보인다.
   */
  it("주소가 없는 채널은 실패가 아니다", () => {
    const result = judgeChannelReachability({
      channel: "email",
      enabled: false,
      deliveries: [],
      now: NOW,
    });
    expect(result.verdict).toBe("disabled");
  });

  it("다른 채널의 기록을 섞어 세지 않는다", () => {
    const result = judgeChannelReachability({
      channel: "teams",
      enabled: true,
      deliveries: [delivery({ channel: "slack", at: NOW - HOUR })],
      now: NOW,
    });
    expect(result.verdict).toBe("never");
  });
});

describe("summarizeReachability (TASK-4601)", () => {
  function row(
    channel: "slack" | "email" | "webhook" | "teams",
    enabled: boolean,
    deliveries: DeliveryRecord[],
  ) {
    return judgeChannelReachability({ channel, enabled, deliveries, now: NOW });
  }

  it("전부 도달하면 정상이다", () => {
    const summary = summarizeReachability([
      row("slack", true, [delivery({ channel: "slack", at: NOW - HOUR })]),
      row("teams", true, [delivery({ channel: "teams", at: NOW - HOUR })]),
    ]);
    expect(summary.status).toBe("ok");
    expect(summary.reached).toBe(2);
  });

  /**
   * 켜진 채널이 전부 실패면 지금 이 시스템은 사람에게 말을 걸 수 없다 —
   * 그건 주의가 아니라 실패다.
   */
  it("켜진 채널이 전부 실패면 실패다", () => {
    const summary = summarizeReachability([
      row("slack", true, [delivery({ channel: "slack", at: NOW - HOUR, ok: false })]),
      row("teams", true, [delivery({ channel: "teams", at: NOW - HOUR, ok: false })]),
      row("email", false, []),
    ]);
    expect(summary.status).toBe("fail");
    expect(summary.detail).toContain("말을 걸 수 없습니다");
  });

  it("켜진 채널이 하나도 없으면 실패다", () => {
    const summary = summarizeReachability([row("slack", false, [])]);
    expect(summary.status).toBe("fail");
    expect(summary.active).toBe(0);
  });

  /**
   * 조용한 것은 실패가 아니지만 확인된 것도 아니다.
   */
  it("확인되지 않은 채널만 있으면 주의다", () => {
    const summary = summarizeReachability([
      row("slack", true, [delivery({ channel: "slack", at: NOW - 3 * 24 * HOUR })]),
    ]);
    expect(summary.status).toBe("warn");
    expect(summary.detail).toContain("확인되지 않은 채널");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const summaries = [
      summarizeReachability([row("slack", false, [])]),
      summarizeReachability([
        row("slack", true, [delivery({ channel: "slack", at: NOW - HOUR, ok: false })]),
      ]),
      summarizeReachability([
        row("slack", true, [delivery({ channel: "slack", at: NOW - HOUR })]),
      ]),
    ];
    for (const summary of summaries) {
      expect(summary.detail).not.toContain("**");
      for (const entry of summary.rows) {
        expect(entry.detail).not.toContain("**");
      }
    }
  });
});
