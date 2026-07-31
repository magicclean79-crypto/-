import {
  MAX_IGNORE_DAYS,
  applyIgnores,
  describeRemaining,
  detectIgnoreAwareAlerts,
  judgeIgnoreRequest,
} from "./neglect-ignore";
import type { NeglectIgnore } from "./neglect-ignore";
import { judgeNeglect } from "./neglect";
import type { NeglectReport, NeglectRun } from "./neglect";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const DAY = 86_400_000;
const NEGLECT_AFTER = 7 * DAY;

function runs(count: number, checks: NeglectRun["checks"]): NeglectRun[] {
  return Array.from({ length: count }, (_, index) => ({
    ranAt: NOW - (count - index) * DAY,
    checks,
  }));
}

function report(): NeglectReport {
  return judgeNeglect({
    runs: runs(20, [
      { id: "storage", title: "저장소", status: "fail" },
      { id: "urgent-channel", title: "긴급 경로", status: "warn" },
    ]),
    now: NOW,
    neglectAfterMs: NEGLECT_AFTER,
  });
}

function ignore(over: Partial<NeglectIgnore> = {}): NeglectIgnore {
  return {
    id: "ign-1",
    checkId: "storage",
    tier: "production",
    reason: "S3 전환이 다음 분기 계획에 잡혀 있습니다",
    owner: "김운영",
    reviewAt: NOW + 30 * DAY,
    decidedAt: NOW - DAY,
    decidedBy: "admin@acos.local",
    ...over,
  };
}

describe("judgeIgnoreRequest", () => {
  it("사유와 담당자와 검토일이 있으면 받아들인다", () => {
    const verdict = judgeIgnoreRequest({
      reason: "S3 전환이 다음 분기 계획에 잡혀 있습니다",
      owner: "김운영",
      reviewAt: NOW + 30 * DAY,
      now: NOW,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("무시는 해결이 아닙니다");
  });

  /**
   * 이름이 없으면 검토일이 와도 아무에게도 돌아가지 않는다 — 그 무시는
   * 사실상 영구 삭제다.
   */
  it("담당자가 없으면 거절한다", () => {
    const verdict = judgeIgnoreRequest({
      reason: "지금은 고칠 수 없습니다",
      owner: "  ",
      reviewAt: NOW + DAY,
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("사람이어야 합니다");
  });

  it("사유가 짧으면 거절하고 무엇이 부족한지 말한다", () => {
    const verdict = judgeIgnoreRequest({
      reason: "나중에",
      owner: "김운영",
      reviewAt: NOW + DAY,
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("자 이상");
  });

  it("항목 제목을 다시 적은 것은 사유가 아니다", () => {
    const verdict = judgeIgnoreRequest({
      reason: "저장소 백업 실패",
      owner: "김운영",
      reviewAt: NOW + DAY,
      now: NOW,
      title: "저장소 백업 실패",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("왜 지금 고치지");
  });

  it("검토일이 지난 날짜면 거절한다", () => {
    const verdict = judgeIgnoreRequest({
      reason: "다음 분기 계획에 있습니다",
      owner: "김운영",
      reviewAt: NOW - 1,
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("앞날이어야");
  });

  /**
   * 무기한 무시는 "안 고치기로 했다"를 기록하는 것이 아니라 잊는 것이다.
   */
  it("검토일이 상한을 넘으면 거절한다", () => {
    const verdict = judgeIgnoreRequest({
      reason: "다음 분기 계획에 있습니다",
      owner: "김운영",
      reviewAt: NOW + (MAX_IGNORE_DAYS + 1) * DAY,
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("잊는 것이고");
  });
});

/**
 * 라이브 검증에서 드러난 결함: 사람이 20일 뒤로 정한 검토일이 화면에서
 * "19일 뒤"로 보였다. 지나간 기간은 내림이 맞지만(23일째가 24일째로 보이면
 * 안 된다) 남은 기간에 내림을 쓰면 입력한 값과 보이는 값이 어긋난다.
 */
describe("describeRemaining", () => {
  it("남은 기간은 가까운 쪽으로 반올림한다", () => {
    expect(describeRemaining(20 * DAY - 1000)).toBe("20일");
    expect(describeRemaining(19.2 * DAY)).toBe("19일");
    expect(describeRemaining(2 * 3_600_000)).toBe("2시간");
    expect(describeRemaining(30_000)).toBe("1분");
    expect(describeRemaining(0)).toBe("0일");
  });
});

describe("applyIgnores", () => {
  it("무시해도 목록에서 빼지 않고 기간도 그대로 둔다", () => {
    const base = report();
    const applied = applyIgnores(base, [ignore()], { tier: "production", now: NOW });
    const storage = applied.streaks.find((row) => row.id === "storage");
    expect(applied.streaks).toHaveLength(base.streaks.length);
    expect(storage?.ignored).toBe(true);
    expect(storage?.runs).toBe(20);
    expect(storage?.durationMs).toBe(base.streaks.find((r) => r.id === "storage")?.durationMs);
    expect(storage?.ignoreLabel).toContain("무시 중");
    // 사람이 정한 30일이 그대로 보인다 — 29일로 보이면 화면을 안 믿는다
    expect(storage?.ignoreLabel).toContain("30일 뒤 검토");
    expect(storage?.ignoreLabel).toContain("김운영");
    // 화면이 취소를 걸 수 있어야 한다 — 등록만 되고 취소가 없으면 잘못 적은
    // 무시가 검토일까지 그대로 남는다 (라이브 검증에서 고침)
    expect(storage?.ignoreId).toBe("ign-1");
  });

  /**
   * 빼서 말하면 무시를 늘리는 것만으로 지표가 좋아진다 — 지표를 고친 것이
   * 아니라 눈을 가린 것이다.
   */
  it("방치 건수에서 빼지 않는다", () => {
    const applied = applyIgnores(report(), [ignore()], {
      tier: "production",
      now: NOW,
    });
    expect(applied.ignoredCount).toBe(1);
    expect(applied.detail).toContain("방치 건수에서 빼지");
  });

  it("검토일이 지나면 무시가 아니다", () => {
    const applied = applyIgnores(report(), [ignore({ reviewAt: NOW - DAY })], {
      tier: "production",
      now: NOW,
    });
    const storage = applied.streaks.find((row) => row.id === "storage");
    expect(storage?.ignored).toBe(false);
    expect(storage?.reviewOverdue).toBe(true);
    expect(storage?.ignoreLabel).toContain("검토일 지남");
    expect(applied.detail).toContain("다시 경보");
  });

  /**
   * 운영에서 무시한 것이 스테이징 검증까지 덮으면, 검증하는 사람이 가장
   * 늦게 안다.
   */
  it("다른 배포 단계의 무시는 적용하지 않는다", () => {
    const applied = applyIgnores(report(), [ignore({ tier: "production" })], {
      tier: "staging",
      now: NOW,
    });
    expect(applied.ignoredCount).toBe(0);
    expect(applied.streaks.every((row) => !row.ignored)).toBe(true);
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const applied = applyIgnores(
      report(),
      [ignore(), ignore({ checkId: "urgent-channel", reviewAt: NOW - DAY })],
      { tier: "production", now: NOW },
    );
    expect(applied.detail).not.toContain("**");
    for (const streak of applied.streaks) {
      expect(streak.ignoreLabel ?? "").not.toContain("**");
    }
  });
});

describe("detectIgnoreAwareAlerts", () => {
  const alerting = { tier: "production", alerting: true, neglectAfterMs: NEGLECT_AFTER };

  it("무시 중인 항목은 경보에서 뺀다", () => {
    const applied = applyIgnores(
      report(),
      [ignore(), ignore({ checkId: "urgent-channel" })],
      { tier: "production", now: NOW },
    );
    expect(detectIgnoreAwareAlerts(applied, alerting)).toEqual([]);
  });

  it("무시하지 않은 방치는 그대로 경보한다", () => {
    const applied = applyIgnores(report(), [ignore()], {
      tier: "production",
      now: NOW,
    });
    const alerts = detectIgnoreAwareAlerts(applied, alerting);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("1개");
    expect(alerts[0].message).toContain("검토일을 정하는 편이");
  });

  /**
   * 이것이 무시가 영구 삭제로 변질되지 않는 유일한 장치다.
   */
  it("검토일이 지나면 다른 경보로 되돌아온다", () => {
    const applied = applyIgnores(report(), [ignore({ reviewAt: NOW - DAY })], {
      tier: "production",
      now: NOW,
    });
    const alerts = detectIgnoreAwareAlerts(applied, alerting);
    const overdue = alerts.find((row) => row.key.includes("ignore-overdue"));
    expect(overdue).toBeDefined();
    expect(overdue?.message).toContain("김운영");
    expect(overdue?.message).toContain("자동으로 풀립니다");
  });

  it("개발에서는 경보하지 않는다", () => {
    const applied = applyIgnores(report(), [], { tier: "development", now: NOW });
    expect(
      detectIgnoreAwareAlerts(applied, {
        tier: "development",
        alerting: false,
        neglectAfterMs: NEGLECT_AFTER,
      }),
    ).toEqual([]);
  });
});
