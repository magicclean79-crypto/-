import {
  describeRevival,
  judgeRevival,
  revivalOutcome,
  summarizeRevivals,
} from "./draft-revival";
import type { ExpiredDraftState, RevivalRecord } from "./draft-revival";

const NOW = Date.parse("2026-07-31T00:00:00Z");
const DAY = 86_400_000;

function expired(overrides: Partial<ExpiredDraftState> = {}): ExpiredDraftState {
  return {
    status: "DRAFT",
    expiredAt: NOW - 23 * DAY,
    createdAt: NOW - 53 * DAY,
    ...overrides,
  };
}

describe("judgeRevival", () => {
  it("만료된 초안을 사유와 함께 확인할 수 있다", () => {
    const judged = judgeRevival({
      draft: expired(),
      action: "confirm",
      reason: "비슷한 사고가 다시 나서 되짚어 보니 그때도 같은 원인이었습니다",
      summary: "OpenAI 호출 실패로 상세페이지 생성이 40분 멈춤",
      now: NOW,
    });
    expect(judged.ok).toBe(true);
    expect(judged.latenessMs).toBe(23 * DAY);
  });

  it("만료되지 않은 초안에는 쓸 수 없다 — 두 경로가 같은 일을 하면 기록이 흐려진다", () => {
    const judged = judgeRevival({
      draft: expired({ expiredAt: null }),
      action: "confirm",
      reason: "확인합니다",
      summary: "장애 설명입니다",
      now: NOW,
    });
    expect(judged.ok).toBe(false);
    expect(judged.reason).toContain("만료되지 않은 초안");
  });

  it("이미 판단이 끝난 기록에는 쓸 수 없다", () => {
    const judged = judgeRevival({
      draft: expired({ status: "CONFIRMED" }),
      action: "dismiss",
      reason: "다시 봤습니다",
      now: NOW,
    });
    expect(judged.ok).toBe(false);
    expect(judged.reason).toContain("이미 판단이 끝난");
  });

  it("사유 없이 되살릴 수 없다", () => {
    const judged = judgeRevival({
      draft: expired(),
      action: "reopen",
      reason: "음",
      now: NOW,
    });
    expect(judged.ok).toBe(false);
    expect(judged.reason).toContain("앞사람의 판단을 참고할 수 없습니다");
  });

  it("확인할 때는 장애 설명도 요구한다 — 경보 제목은 장애의 설명이 아니다", () => {
    const judged = judgeRevival({
      draft: expired(),
      action: "confirm",
      reason: "뒤늦게 진짜 장애였음이 드러났습니다",
      summary: "경보",
      now: NOW,
    });
    expect(judged.ok).toBe(false);
    expect(judged.reason).toContain("경보의 이름이지");
  });

  it("기각·만료취소에는 장애 설명이 필요 없다", () => {
    for (const action of ["dismiss", "reopen"] as const) {
      expect(
        judgeRevival({
          draft: expired(),
          action,
          reason: "휴가 중이어서 아무도 못 봤습니다",
          now: NOW,
        }).ok,
      ).toBe(true);
    }
  });
});

describe("revivalOutcome", () => {
  it("확인·기각은 만료됐던 사실을 지우지 않는다", () => {
    expect(revivalOutcome("confirm")).toEqual({
      status: "CONFIRMED",
      clearExpiry: false,
    });
    expect(revivalOutcome("dismiss")).toEqual({
      status: "DISMISSED",
      clearExpiry: false,
    });
  });

  it("만료 취소만 만료 표시를 비운다 — 그것이 그 조치의 내용이다", () => {
    expect(revivalOutcome("reopen")).toEqual({ status: "DRAFT", clearExpiry: true });
  });
});

describe("describeRevival", () => {
  it("얼마나 늦었는지 적는다 — 하루와 석 달이 같아 보이면 개선 대상이 못 된다", () => {
    const line = describeRevival({
      action: "confirm",
      latenessMs: 23 * DAY,
      reason: "비슷한 사고 재발",
    });
    expect(line).toContain("만료 23일 뒤");
    expect(line).toContain("초안 → 장애");
    // 라이브에서 "만료 23일 뒤 만료 뒤 확인"으로 보였다 — 앞에서 이미
    // 얼마나 늦었는지 말하므로 이름에는 "만료 뒤"를 넣지 않는다
    expect(line).not.toContain("만료 뒤");
  });

  it("만료 당일에 손댄 것도 그렇게 적는다", () => {
    expect(describeRevival({ action: "reopen", latenessMs: 3600_000, reason: "휴가" })).toContain(
      "만료 당일",
    );
  });
});

describe("summarizeRevivals", () => {
  const record = (action: RevivalRecord["action"], days: number): RevivalRecord => ({
    action,
    latenessMs: days * DAY,
    revivedAt: NOW,
  });

  it("되살린 적이 없으면 평균을 0으로 적지 않는다", () => {
    const summary = summarizeRevivals([]);
    expect(summary.averageLatenessMs).toBeNull();
    expect(summary.detail).toContain("되살린 적이 없습니다");
  });

  it("만료 뒤 확인된 것을 성과로 적지 않는다", () => {
    const summary = summarizeRevivals([record("confirm", 20), record("dismiss", 4)]);
    expect(summary.confirmed).toBe(1);
    expect(summary.detail).toContain("잘 처리한 기록이 아니라");
    expect(summary.detail).toContain("늦게 알았다는 기록");
  });

  it("평균 지각을 낸다", () => {
    const summary = summarizeRevivals([record("confirm", 10), record("confirm", 20)]);
    expect(summary.averageLatenessMs).toBe(15 * DAY);
    expect(summary.detail).toContain("평균 15일");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    expect(summarizeRevivals([record("confirm", 5)]).detail).not.toContain("**");
    expect(summarizeRevivals([]).detail).not.toContain("**");
  });
});
