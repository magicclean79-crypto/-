import {
  IGNORE_ESCALATE_AFTER_MS,
  detectEscalationAlerts,
  planIgnoreNotices,
} from "./ignore-escalation";
import type { IgnoreWithNotice } from "./ignore-escalation";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const DAY = 86_400_000;

function ignore(over: Partial<IgnoreWithNotice> = {}): IgnoreWithNotice {
  return {
    id: "ign-1",
    checkId: "storage",
    title: "오브젝트 저장소",
    tier: "production",
    reason: "S3 전환이 다음 분기 계획에 잡혀 있습니다",
    owner: "김운영",
    reviewAt: NOW + 30 * DAY,
    decidedAt: NOW - DAY,
    decidedBy: "admin@acos.local",
    lastStage: null,
    lastNotifiedAt: null,
    ...over,
  };
}

describe("planIgnoreNotices", () => {
  it("검토일이 멀면 아무것도 보내지 않는다", () => {
    const plan = planIgnoreNotices({ ignores: [ignore()], now: NOW });
    expect(plan.notices).toEqual([]);
    expect(plan.quiet).toBe(1);
  });

  it("검토일 3일 안이면 담당자에게 미리 알린다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW + 2 * DAY })],
      now: NOW,
    });
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]).toMatchObject({
      stage: "due-soon",
      broadcast: false,
      owner: "김운영",
    });
    expect(plan.notices[0].title).toContain("2일 뒤 검토");
  });

  it("검토일이 지나면 지났다고 알린다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW - DAY })],
      now: NOW,
    });
    expect(plan.notices[0]).toMatchObject({ stage: "overdue", broadcast: false });
    expect(plan.notices[0].message).toContain("무시는 이미 풀렸고");
  });

  /**
   * 에스컬레이션은 등급을 올리는 것이 아니라 받는 사람을 넓히는 것이다 —
   * 2주 된 소식이 지금 터진 장애와 같은 소리로 울리면 진짜 장애가 묻힌다.
   */
  it("2주가 지나면 운영 채널까지 넓히되 등급은 올리지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW - IGNORE_ESCALATE_AFTER_MS })],
      now: NOW,
    });
    expect(plan.notices[0]).toMatchObject({ stage: "escalated", broadcast: true });
    expect(plan.notices[0].message).toContain("등급을 올리지는 않았습니다");

    const alerts = detectEscalationAlerts(plan, { alerting: true });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("warning");
  });

  /**
   * 매일 같은 문장이 오면 그 알림부터 무시하게 되고, 그러면 검토일 자체가
   * 의미를 잃는다.
   */
  it("같은 단계를 하루 안에 다시 보내지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [
        ignore({
          reviewAt: NOW - DAY,
          lastStage: "overdue",
          lastNotifiedAt: NOW - 3 * 3_600_000,
        }),
      ],
      now: NOW,
    });
    expect(plan.notices).toEqual([]);
    expect(plan.suppressed).toBe(1);
  });

  /**
   * "곧 검토일"과 "이미 지났다"와 "2주째 응답 없음"은 서로 다른 소식이다.
   */
  it("단계가 바뀌면 쿨다운과 무관하게 보낸다", () => {
    const plan = planIgnoreNotices({
      ignores: [
        ignore({
          reviewAt: NOW - DAY,
          lastStage: "due-soon",
          lastNotifiedAt: NOW - 3_600_000,
        }),
      ],
      now: NOW,
    });
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0].stage).toBe("overdue");
  });

  /**
   * 알림이 상태를 바꾸면, 보내는 것만으로 문제가 사라지는 셈이 된다.
   */
  it("알림이 무시를 연장하지 않는다는 사실을 적는다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW - DAY })],
      now: NOW,
    });
    expect(plan.detail).toContain("검토일이 밀리거나 무시가 되살아나지 않습니다");
  });

  it("제목이 없으면 항목 id를 쓴다 — 지어내지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW - DAY, title: undefined })],
      now: NOW,
    });
    expect(plan.notices[0].title).toContain("storage");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [
        ignore({ reviewAt: NOW + 2 * DAY }),
        ignore({ checkId: "urgent", reviewAt: NOW - 20 * DAY }),
      ],
      now: NOW,
    });
    expect(plan.detail).not.toContain("**");
    for (const notice of plan.notices) {
      expect(notice.title).not.toContain("**");
      expect(notice.message).not.toContain("**");
    }
  });
});

describe("detectEscalationAlerts", () => {
  /**
   * 담당자 알림까지 경보로 만들면 경보 목록이 개인 할 일 목록이 되고,
   * 그러면 아무도 경보 목록을 운영 상태로 읽지 않게 된다.
   */
  it("담당자 알림은 경보로 만들지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW - DAY })],
      now: NOW,
    });
    expect(detectEscalationAlerts(plan, { alerting: true })).toEqual([]);
  });

  it("경보를 내지 않는 단계에서는 아무것도 내지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [ignore({ reviewAt: NOW - 20 * DAY })],
      now: NOW,
    });
    expect(detectEscalationAlerts(plan, { alerting: false })).toEqual([]);
  });

  it("항목마다 다른 키를 써서 서로를 해소하지 않는다", () => {
    const plan = planIgnoreNotices({
      ignores: [
        ignore({ checkId: "a", reviewAt: NOW - 20 * DAY }),
        ignore({ checkId: "b", reviewAt: NOW - 20 * DAY }),
      ],
      now: NOW,
    });
    const alerts = detectEscalationAlerts(plan, { alerting: true });
    expect(new Set(alerts.map((row) => row.key)).size).toBe(2);
  });
});
