import { detectAttributionAlerts, summarizeProjectCost } from "./project-cost";
import type { CostRecord } from "./project-cost";

function record(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    projectId: "p1",
    source: "llm",
    cost: 1,
    diagnostic: false,
    ...overrides,
  };
}

const names = { p1: "상세페이지 프로젝트", p2: "카탈로그 프로젝트" };

describe("summarizeProjectCost", () => {
  it("프로젝트별로 모으고 큰 것부터 놓는다", () => {
    const report = summarizeProjectCost({
      records: [
        record({ projectId: "p1", cost: 1 }),
        record({ projectId: "p2", cost: 3 }),
        record({ projectId: "p1", cost: 1 }),
      ],
      names,
      windowDays: 30,
    });
    expect(report.rows.map((row) => row.projectId)).toEqual(["p2", "p1"]);
    expect(report.rows[0].cost).toBe(3);
    expect(report.rows[1].calls).toBe(2);
    expect(report.attributed).toBe(5);
  });

  /**
   * 이 검사가 이 파일의 존재 이유다 — 미배분을 프로젝트 비율로 나눠 얹으면
   * 합계가 맞고 표가 깔끔해지지만, 그 숫자는 관측이 아니라 만들어낸 것이고
   * 그걸로 팀에 비용을 청구하게 된다.
   */
  it("귀속되지 않은 금액을 프로젝트에 나눠 얹지 않는다", () => {
    const report = summarizeProjectCost({
      records: [
        record({ projectId: "p1", cost: 1 }),
        record({ projectId: null, cost: 9 }),
      ],
      names,
      windowDays: 30,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].cost).toBe(1);
    expect(report.unattributed).toBe(9);
    expect(report.detail).toContain("나눠 얹지 않았습니다");
    expect(report.detail).toContain("만들어낸 것이 됩니다");
  });

  it("비율의 분모는 미배분을 포함한 전체다 — 빼고 나누면 몫이 커 보인다", () => {
    const report = summarizeProjectCost({
      records: [
        record({ projectId: "p1", cost: 1 }),
        record({ projectId: null, cost: 3 }),
      ],
      names,
      windowDays: 30,
    });
    // 1/(1+3) = 25%. 미배분을 빼면 100%가 되어 "이 프로젝트가 전부 썼다"가 된다
    expect(report.rows[0].share).toBe(25);
  });

  it("진단·스모크는 프로젝트 비용이 아니므로 따로 둔다", () => {
    const report = summarizeProjectCost({
      records: [
        record({ projectId: "p1", cost: 2 }),
        record({ projectId: null, cost: 5, diagnostic: true }),
      ],
      names,
      windowDays: 30,
    });
    expect(report.diagnostic).toBe(5);
    expect(report.unattributed).toBe(0);
    expect(report.unattributedCalls).toBe(0);
    expect(report.detail).toContain("프로젝트 비용이 아니므로");
  });

  /**
   * 미산정(금액을 모른다)과 미배분(주인을 모른다)은 다른 문제다 —
   * 한 칸에 넣으면 어느 쪽을 고쳐야 하는지 알 수 없다.
   */
  it("금액을 모르는 것과 주인을 모르는 것을 가른다", () => {
    const report = summarizeProjectCost({
      records: [
        record({ projectId: "p1", cost: null }),
        record({ projectId: null, cost: 4 }),
      ],
      names,
      windowDays: 30,
    });
    expect(report.unpricedCalls).toBe(1);
    expect(report.unattributedCalls).toBe(1);
    expect(report.detail).toContain("주인을 모르는 것과 다른 문제");
    expect(report.rows[0].unpricedCalls).toBe(1);
  });

  it("귀속률을 내고, 100%가 아니면 적게 청구된다고 말한다", () => {
    const report = summarizeProjectCost({
      records: [
        record({ projectId: "p1" }),
        record({ projectId: "p1" }),
        record({ projectId: null }),
        record({ projectId: null }),
      ],
      names,
      windowDays: 30,
    });
    expect(report.coverage).toBe(50);
    expect(report.caveat).toContain("적게 청구됩니다");
  });

  it("표본이 없으면 귀속률을 0%로 적지 않는다", () => {
    const report = summarizeProjectCost({ records: [], names, windowDays: 30 });
    expect(report.coverage).toBeNull();
    expect(report.caveat).toContain("낼 수 없습니다");
    expect(report.detail).toContain("과금된 호출이 없습니다");
  });

  it("이름을 모르는 프로젝트도 비용을 잃지 않는다", () => {
    const report = summarizeProjectCost({
      records: [record({ projectId: "deleted-1", cost: 2 })],
      names,
      windowDays: 30,
    });
    expect(report.rows[0].name).toBe("deleted-1");
    expect(report.rows[0].cost).toBe(2);
  });

  it("전체가 0이면 비율을 0%로 적지 않는다", () => {
    const report = summarizeProjectCost({
      records: [record({ projectId: "p1", cost: null })],
      names,
      windowDays: 30,
    });
    expect(report.rows[0].share).toBeNull();
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = summarizeProjectCost({
      records: [record({ projectId: null, cost: 1 }), record({ cost: null })],
      names,
      windowDays: 30,
    });
    expect(report.detail).not.toContain("**");
    expect(report.caveat).not.toContain("**");
  });
});

describe("detectAttributionAlerts", () => {
  const low = () =>
    summarizeProjectCost({
      records: [record({ projectId: "p1" }), record({ projectId: null })],
      names,
      windowDays: 30,
    });

  it("경보를 내지 않는 단계에서는 아무것도 내지 않는다", () => {
    expect(detectAttributionAlerts(low(), { alerting: false, minCoverage: 80 })).toEqual([]);
  });

  it("귀속률이 충분하면 내지 않는다", () => {
    const good = summarizeProjectCost({
      records: [record({ projectId: "p1" }), record({ projectId: "p2" })],
      names,
      windowDays: 30,
    });
    expect(detectAttributionAlerts(good, { alerting: true, minCoverage: 80 })).toEqual([]);
  });

  it("표본이 없으면 경보하지 않는다 — 모르는 것은 나쁜 것이 아니다", () => {
    const empty = summarizeProjectCost({ records: [], names, windowDays: 30 });
    expect(detectAttributionAlerts(empty, { alerting: true, minCoverage: 80 })).toEqual([]);
  });

  it("귀속률이 낮으면 표를 믿을 수 없다고 말한다 — 금액이 크다고 부르지 않는다", () => {
    const alerts = detectAttributionAlerts(low(), { alerting: true, minCoverage: 80 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("warning");
    expect(alerts[0].key).toBe("cost-attribution:coverage");
    expect(alerts[0].message).toContain("실제보다 적게 청구됩니다");
  });
});
