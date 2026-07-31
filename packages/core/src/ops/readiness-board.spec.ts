import { buildReadinessBoard } from "./readiness-board";

type BoardInput = Parameters<typeof buildReadinessBoard>[0];

const CHECKED_AT = "2026-07-31T12:00:00.000Z";

function build(over: Partial<BoardInput> = {}): ReturnType<typeof buildReadinessBoard> {
  return buildReadinessBoard({
    plan: {
      readiness: "blocked",
      done: 2,
      total: 11,
      waitingOnPeople: [{ title: "실 Provider 자격 증명 주입" }],
      waitingOnUs: [{ title: "KPI 기준선 확보" }],
      detail: "검증 스프린트 준비 2/11 단계 완료.",
    },
    runGate: { allowed: false, reasons: ["검증 대상이 정해지지 않았습니다"] },
    diagnostics: { fail: 0, warn: 2, unknown: 0, detail: "일일 진단 · 주의 2건" },
    cutover: { verified: 0, total: 3, notProduction: 3 },
    hosts: { declared: 2, undeclared: 1, detail: "선언된 운영 호스트 2개." },
    neglect: { neglected: 2, ignored: 1, overdue: 0, worstLabel: "저장소(23일째)" },
    attribution: { coverage: 12, recentCoverage: 100, minCoverage: 80 },
    runbook: {
      done: 1,
      total: 8,
      nextTitle: "실 Provider 자격 증명 주입",
      detail: "운영 활성화 런북 1/8 단계 완료.",
    },
    tier: "staging",
    checkedAt: CHECKED_AT,
    ...over,
  });
}

describe("buildReadinessBoard", () => {
  it("준비 단계의 분모를 그대로 쓴다", () => {
    const board = build();
    expect(board.steps).toEqual({ done: 2, total: 11 });
    expect(board.readiness).toBe("blocked");
    expect(board.detail).toContain("준비 2/11 단계");
  });

  /**
   * 각 칸이 어느 판정에서 왔는지 달고 다녀야, 두 화면이 다른 말을 할 때
   * 그것을 숨길 수 없다 (TASK-4101 라이브 결함의 재발 방지).
   */
  it("모든 칸이 출처를 달고 다닌다", () => {
    for (const tile of build().tiles) {
      expect(tile.source).toMatch(/^GET \/ops\//);
    }
  });

  it("판정을 읽지 못한 칸을 통과로 세지 않는다", () => {
    const board = build({ diagnostics: null, hosts: null });
    const ids = board.unknowns.map((tile) => tile.id);
    expect(ids).toEqual(expect.arrayContaining(["diagnostics", "hosts"]));
    expect(board.detail).toContain("통과로 세지 않았습니다");
    for (const tile of board.unknowns) {
      expect(tile.detail).toContain("괜찮다는 뜻이 아닙니다");
    }
  });

  /**
   * unknown이 ok 옆에서 조용하면, 모르는 항목이 많은 환경이 건강해 보인다.
   */
  it("진단에 모르는 항목이 있으면 초록이 아니다", () => {
    const board = build({
      diagnostics: { fail: 0, warn: 0, unknown: 1, detail: "확인 못 한 항목 1건" },
    });
    const tile = board.tiles.find((row) => row.id === "diagnostics");
    expect(tile?.status).toBe("unknown");
    expect(tile?.next).toContain("통과가 아닙니다");
  });

  it("막고 있는 것을 앞으로 모은다", () => {
    const board = build();
    expect(board.blockers.map((tile) => tile.id)).toEqual(
      expect.arrayContaining(["validation-plan", "validation-run", "cutover"]),
    );
    expect(board.detail).toContain("지금 막고 있는 것");
  });

  /**
   * 무시를 빼서 말하면, 무시를 늘리는 것만으로 대시보드가 좋아진다.
   */
  it("방치에서 무시 중인 건을 빼서 말하지 않는다", () => {
    const tile = build().tiles.find((row) => row.id === "neglect");
    expect(tile?.detail).toContain("항목 2건");
    expect(tile?.detail).toContain("무시 중 1건");
  });

  it("검토일이 지난 무시가 있으면 방치 칸이 주의가 된다", () => {
    const board = build({
      neglect: { neglected: 1, ignored: 1, overdue: 1, worstLabel: null },
    });
    const tile = board.tiles.find((row) => row.id === "neglect");
    expect(tile?.status).toBe("warn");
    expect(tile?.next).toContain("다시 보기로 한 날이 지난");
  });

  /**
   * 표본이 없을 때 100%로 칠하면 아무 호출도 없는 환경이 가장 잘한 환경이
   * 된다.
   */
  it("귀속률을 잴 수 없으면 초록이 아니다", () => {
    const board = build({
      attribution: { coverage: null, recentCoverage: null, minCoverage: 80 },
    });
    const tile = board.tiles.find((row) => row.id === "attribution");
    expect(tile?.status).toBe("unknown");
    expect(tile?.detail).toContain("잴 수 없습니다");
  });

  it("전체 귀속률이 낮아도 지금 들어오는 기록이 좋으면 그렇게 말한다", () => {
    const tile = build().tiles.find((row) => row.id === "attribution");
    expect(tile?.status).toBe("ok");
    expect(tile?.detail).toContain("지금 들어오는 기록 100%");
    expect(tile?.detail).toContain("전체 12%");
  });

  it("준비 판정을 못 읽으면 준비 상태를 말하지 않는다", () => {
    const board = build({ plan: null });
    expect(board.readiness).toBe("unknown");
    expect(board.detail).toContain("준비 상태를 말할 수 없습니다");
  });

  it("여기서 다시 판정하지 않는다는 사실을 화면에 적는다", () => {
    expect(build().detail).toContain("인용만 합니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const board = build({ plan: null, runGate: null, neglect: null });
    expect(board.detail).not.toContain("**");
    for (const tile of board.tiles) {
      expect(tile.detail).not.toContain("**");
      expect(tile.next ?? "").not.toContain("**");
    }
  });
});
