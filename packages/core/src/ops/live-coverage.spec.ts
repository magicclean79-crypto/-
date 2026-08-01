import {
  CI_AVAILABLE_NEEDS,
  LIVE_CHECKS,
  humanOnlyChecks,
  judgeCiCoverage,
} from "./live-coverage";

describe("judgeCiCoverage (TASK-4701)", () => {
  /**
   * 가장 중요한 문장이다. TASK-3501에서 스텁 상대 성공 기록을 "연결됨"으로
   * 셀 뻔했다 — 같은 사고를 CI에서 반복하면 안 된다.
   */
  it("CI가 초록이라고 라이브 검증이 끝난 것이 아니라고 말한다", () => {
    const report = judgeCiCoverage();
    expect(report.caveat).toContain("배선");
    expect(report.caveat).toContain("라이브 검증이 끝난 것이 아닙니다");
  });

  it("돈이 나가는 호출은 CI에서 돌 수 없다", () => {
    expect(CI_AVAILABLE_NEEDS).not.toContain("paid-call");
    expect(CI_AVAILABLE_NEEDS).not.toContain("provider-credentials");
    expect(CI_AVAILABLE_NEEDS).not.toContain("human-eyes");
  });

  it("자격 증명이 필요한 검사는 사람 몫으로 남는다", () => {
    const report = judgeCiCoverage();
    const real = report.checks.find((check) => check.id === "real-provider-call");
    expect(real?.verdict).toBe("human-only");
    expect(real?.blockedBy).toContain("paid-call");
  });

  it("DB와 스텁만 필요한 검사는 CI에서 돈다", () => {
    const report = judgeCiCoverage();
    const batch = report.checks.find((check) => check.id === "job-batch-succeeds");
    expect(batch?.verdict).toBe("ci");
    expect(batch?.blockedBy).toHaveLength(0);
  });

  /** 사람 눈이 필요한 것은 브라우저가 있어도 CI 몫이 아니다 */
  it("사람이 읽어야 아는 것은 브라우저가 있어도 사람 몫이다", () => {
    const report = judgeCiCoverage();
    const screen = report.checks.find((check) => check.id === "screen-reads-right");
    expect(screen?.verdict).toBe("human-only");
    expect(screen?.blockedBy).toEqual(["human-eyes"]);
  });

  /**
   * 87.5%를 88%로 올리면 그 0.5%는 영영 돌아오지 않는 검사인데 숫자로는
   * 이미 있는 것처럼 보인다.
   */
  it("비율을 올림하지 않는다", () => {
    const report = judgeCiCoverage(
      [
        { id: "a", title: "a", needs: ["postgres"], proves: "-" },
        { id: "b", title: "b", needs: ["postgres"], proves: "-" },
        { id: "c", title: "c", needs: ["paid-call"], proves: "-" },
      ],
      CI_AVAILABLE_NEEDS,
    );
    // 2/3 = 66.66… → 66
    expect(report.ciPercent).toBe(66);
  });

  it("셈이 맞는다", () => {
    const report = judgeCiCoverage();
    expect(report.ciCount + report.humanCount).toBe(LIVE_CHECKS.length);
    expect(report.summary).toContain(`${report.ciCount}건이 CI에서`);
  });

  it("검사가 하나도 없으면 0%다", () => {
    expect(judgeCiCoverage([]).ciPercent).toBe(0);
  });

  it("검사 id가 겹치지 않는다", () => {
    const ids = LIVE_CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("humanOnlyChecks", () => {
  it("사람만 할 수 있는 검사와 그 이유를 낸다", () => {
    const rows = humanOnlyChecks();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.blockedBy.length).toBeGreaterThan(0);
      expect(row.proves.length).toBeGreaterThan(0);
    }
  });

  /**
   * 실 Provider가 주는 usage의 의미는 우리가 확인할 수 없다 — 캐시·생각
   * 토큰의 계산은 문서를 믿고 있는 것이고, 그 사실을 감추면 안 된다.
   */
  it("우리가 확인할 수 없는 것을 확인할 수 없다고 적는다", () => {
    const rows = humanOnlyChecks();
    const usage = rows.find((row) => row.proves.includes("캐시"));
    expect(usage?.proves).toContain("확인할 수 없습니다");
  });
});
