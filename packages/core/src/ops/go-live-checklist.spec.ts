import {
  buildGoLiveChecklist,
  GO_LIVE_ITEMS,
  type GoLiveState,
} from "./go-live-checklist";

function states(
  overrides: Record<string, GoLiveState> = {},
): Record<string, { state: GoLiveState; detail: string }> {
  const result: Record<string, { state: GoLiveState; detail: string }> = {};
  for (const item of GO_LIVE_ITEMS) {
    result[item.id] = {
      state: overrides[item.id] ?? "met",
      detail: `${item.title} 상태`,
    };
  }
  return result;
}

describe("buildGoLiveChecklist (TASK-4501, 정책 4501-⑤)", () => {
  it("전부 충족하면 선언 가능이다 — 그래도 선언은 사람이 한다", () => {
    const report = buildGoLiveChecklist({ states: states() });
    expect(report.verdict).toBe("declarable");
    expect(report.blocking).toEqual([]);
    expect(report.detail).toContain("선언은 사람이 합니다");
  });

  /**
   * 이것이 이 판정의 존재 이유다. 검증을 안 돌린 채 얻은 초록은 전부 스텁의
   * 초록이고, 그 상태에서 "7/8 완료"라고 말하면 숫자가 진행을 흉내 낸다.
   */
  it("검증이 성공하지 않으면 시작도 안 한 것으로 본다", () => {
    const report = buildGoLiveChecklist({
      states: states({ validation: "unmet" }),
    });
    expect(report.verdict).toBe("not-started");
    expect(report.detail).toContain("아직 시작도 안 했다는 뜻");
    expect(report.detail).not.toContain("7/8");
  });

  it("검증 상태를 못 읽어도 시작도 안 한 것으로 본다", () => {
    const report = buildGoLiveChecklist({ states: {} });
    expect(report.verdict).toBe("not-started");
    expect(report.items.every((item) => item.state === "unknown")).toBe(true);
  });

  /**
   * 모르는 것을 통과로 처리하지 않는다 — unknown은 unmet과 같은 무게로 막는다.
   */
  it("읽지 못한 항목은 통과로 세지 않는다", () => {
    const base = states();
    delete base.drill;
    const report = buildGoLiveChecklist({ states: base });
    expect(report.verdict).toBe("incomplete");
    expect(report.met).toBe(GO_LIVE_ITEMS.length - 1);
    expect(report.detail).toContain("상태를 읽지 못한 것이며 통과로 세지 않았습니다");
  });

  it("남은 항목을 이름으로 말한다", () => {
    const report = buildGoLiveChecklist({
      states: states({ hosts: "unmet", neglect: "unmet" }),
    });
    expect(report.verdict).toBe("incomplete");
    expect(report.blocking).toEqual([
      "운영 호스트 목록 확정",
      "방치된 항목 정리",
    ]);
  });

  it("모든 항목에 증거와 인용처가 적혀 있다", () => {
    for (const item of GO_LIVE_ITEMS) {
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.source).toMatch(/^(GET|POST) \//);
      expect(item.why).not.toContain("**");
    }
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const input of [
      states(),
      states({ validation: "unmet" }),
      states({ hosts: "unmet" }),
    ]) {
      expect(buildGoLiveChecklist({ states: input }).detail).not.toContain("**");
    }
  });
});
