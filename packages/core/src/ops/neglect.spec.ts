import { detectNeglectAlerts, judgeNeglect } from "./neglect";
import type { NeglectRun, NeglectStatus } from "./neglect";

const NOW = Date.parse("2026-07-31T07:00:00Z");
const DAY = 86_400_000;
const NEGLECT_AFTER = 7 * DAY;

function run(daysAgo: number, checks: [string, NeglectStatus][]): NeglectRun {
  return {
    ranAt: NOW - daysAgo * DAY,
    checks: checks.map(([id, status]) => ({ id, title: `항목 ${id}`, status })),
  };
}

describe("judgeNeglect", () => {
  it("기록이 없는 것은 '방치가 없다'가 아니다", () => {
    const report = judgeNeglect({ runs: [], now: NOW, neglectAfterMs: NEGLECT_AFTER });
    expect(report.worst).toBeNull();
    expect(report.detail).toContain("방치를 잴 수 없습니다");
  });

  it("지금 나쁜 항목만 연속 기간을 낸다", () => {
    const report = judgeNeglect({
      runs: [run(2, [["db", "fail"]]), run(1, [["db", "ok"]]), run(0, [["db", "ok"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.streaks).toHaveLength(0);
    expect(report.detail).toContain("지금 나쁜 항목이 없습니다");
  });

  it("연속으로 나쁜 횟수와 기간을 센다", () => {
    const report = judgeNeglect({
      runs: [
        run(5, [["db", "ok"]]),
        run(4, [["db", "fail"]]),
        run(2, [["db", "fail"]]),
        run(0, [["db", "fail"]]),
      ],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.streaks).toHaveLength(1);
    expect(report.streaks[0].runs).toBe(3);
    expect(report.streaks[0].durationMs).toBe(4 * DAY);
    expect(report.streaks[0].truncated).toBe(false);
  });

  it("중간에 정상이었으면 거기서 끊는다", () => {
    const report = judgeNeglect({
      runs: [
        run(5, [["db", "fail"]]),
        run(3, [["db", "ok"]]),
        run(1, [["db", "fail"]]),
        run(0, [["db", "fail"]]),
      ],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.streaks[0].runs).toBe(2);
    expect(report.streaks[0].durationMs).toBe(1 * DAY);
  });

  /**
   * 창의 처음부터 계속 나빴다면 실제로는 더 오래됐을 수 있다 — 그것을
   * 확정된 기간으로 적으면 방치가 실제보다 짧게 보인다.
   */
  it("창의 처음부터 나빴으면 최소값이라고 말한다", () => {
    const report = judgeNeglect({
      runs: [run(10, [["db", "fail"]]), run(0, [["db", "fail"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.streaks[0].truncated).toBe(true);
    expect(report.streaks[0].detail).toContain("최소값으로 읽으세요");
  });

  it("unknown도 좋은 것이 아니다 — 연속 실패에 포함한다", () => {
    const report = judgeNeglect({
      runs: [run(3, [["migrations", "unknown"]]), run(0, [["migrations", "unknown"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.streaks).toHaveLength(1);
    expect(report.streaks[0].status).toBe("unknown");
  });

  it("방치 기준을 넘으면 대응 중이 아니라고 말한다", () => {
    const report = judgeNeglect({
      runs: [run(30, [["db", "fail"]]), run(0, [["db", "fail"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.streaks[0].detail).toContain("대응하지 않기로 한 것에 가깝습니다");
    expect(report.detail).toContain("실패 수가 늘지 않았다고 나아진 것이 아닙니다");
  });

  it("가장 오래된 것을 먼저 놓는다", () => {
    const report = judgeNeglect({
      runs: [
        run(20, [["old", "fail"]]),
        run(1, [["old", "fail"], ["new", "fail"]]),
        run(0, [["old", "fail"], ["new", "fail"]]),
      ],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.worst?.id).toBe("old");
    expect(report.streaks[0].id).toBe("old");
  });

  /**
   * 관측이 끊긴 구간은 나빴는지 좋았는지 모른다 — 그 사실을 안 적으면
   * 연속 기간이 실제보다 짧게 보일 수 있다.
   */
  it("관측 공백을 함께 말한다", () => {
    const report = judgeNeglect({
      runs: [run(20, [["db", "fail"]]), run(3, [["db", "fail"]]), run(0, [["db", "fail"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.largestGapMs).toBe(17 * DAY);
    expect(report.detail).toContain("관측이 최대");
    expect(report.detail).toContain("짧게 보일 수 있습니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = judgeNeglect({
      runs: [run(30, [["db", "fail"]]), run(0, [["db", "fail"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(report.detail).not.toContain("**");
    for (const streak of report.streaks) {
      expect(streak.detail).not.toContain("**");
    }
  });
});

describe("detectNeglectAlerts", () => {
  const neglected = () =>
    judgeNeglect({
      runs: [run(30, [["db", "fail"]]), run(0, [["db", "fail"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });

  it("경보를 내지 않는 단계에서는 아무것도 내지 않는다", () => {
    expect(
      detectNeglectAlerts(neglected(), {
        tier: "development",
        alerting: false,
        neglectAfterMs: NEGLECT_AFTER,
      }),
    ).toEqual([]);
  });

  it("기준을 안 넘었으면 내지 않는다", () => {
    const fresh = judgeNeglect({
      runs: [run(1, [["db", "fail"]]), run(0, [["db", "fail"]])],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(
      detectNeglectAlerts(fresh, {
        tier: "production",
        alerting: true,
        neglectAfterMs: NEGLECT_AFTER,
      }),
    ).toEqual([]);
  });

  it("방치는 급한 소식이 아니라 오래된 소식이므로 warning이다", () => {
    const alerts = detectNeglectAlerts(neglected(), {
      tier: "production",
      alerting: true,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("warning");
    expect(alerts[0].key).toBe("diagnostics:neglect:production");
    expect(alerts[0].message).toContain("새로 나빠진 것이 아니라");
  });

  it("항목마다 따로 내지 않고 한 건으로 묶는다", () => {
    const many = judgeNeglect({
      runs: [
        run(30, [["a", "fail"], ["b", "fail"], ["c", "fail"]]),
        run(0, [["a", "fail"], ["b", "fail"], ["c", "fail"]]),
      ],
      now: NOW,
      neglectAfterMs: NEGLECT_AFTER,
    });
    const alerts = detectNeglectAlerts(many, {
      tier: "staging",
      alerting: true,
      neglectAfterMs: NEGLECT_AFTER,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("3개");
  });
});
