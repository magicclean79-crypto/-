import { judgeKpiTrend, shouldTakeSnapshot, summarizeKpiTrends } from "./kpi-trend";
import type { KpiSnapshot } from "./kpi-trend";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-31T00:00:00Z");

function point(value: number | null, daysAgo: number, good = 60, watch = 240): KpiSnapshot {
  return {
    kpiId: "mttr",
    value,
    status: "good",
    thresholdGood: good,
    thresholdWatch: watch,
    takenAt: NOW - daysAgo * DAY,
  };
}

const MTTR = { kpiId: "mttr", direction: "lower-is-better", title: "평균 복구 시간", unit: "분" } as const;

describe("judgeKpiTrend", () => {
  it("스냅샷이 없으면 추세가 아니라 모른다", () => {
    const trend = judgeKpiTrend({ ...MTTR, snapshots: [] });
    expect(trend.direction).toBe("unknown");
    expect(trend.delta).toBeNull();
    expect(trend.detail).toContain("기록된 스냅샷이 없습니다");
  });

  it("한 점으로는 선을 긋지 않는다 — 0% 변화라고 말하지 않는다", () => {
    const trend = judgeKpiTrend({ ...MTTR, snapshots: [point(120, 0)] });
    expect(trend.direction).toBe("unknown");
    expect(trend.delta).toBeNull();
    expect(trend.detail).toContain("한 점으로는 추세가 아닙니다");
  });

  it("작을수록 좋은 지표는 줄면 나아지는 것이다", () => {
    const trend = judgeKpiTrend({ ...MTTR, snapshots: [point(200, 7), point(120, 0)] });
    expect(trend.direction).toBe("improving");
    expect(trend.delta).toBe(-80);
    expect(trend.samples).toBe(2);
  });

  it("클수록 좋은 지표는 방향이 뒤집힌다", () => {
    const trend = judgeKpiTrend({
      kpiId: "checks",
      direction: "higher-is-better",
      title: "예약 점검 통과율",
      unit: "%",
      snapshots: [
        { ...point(80, 7), kpiId: "checks" },
        { ...point(95, 0), kpiId: "checks" },
      ],
    });
    expect(trend.direction).toBe("improving");
    expect(trend.delta).toBe(15);
  });

  it("변화가 없으면 flat이다 (unknown과 다르다)", () => {
    const trend = judgeKpiTrend({ ...MTTR, snapshots: [point(120, 7), point(120, 0)] });
    expect(trend.direction).toBe("flat");
    expect(trend.delta).toBe(0);
  });

  it("값을 낼 수 없었던 시점이 있으면 추세를 내지 않는다 — 없는 표본은 0이 아니다", () => {
    const trend = judgeKpiTrend({ ...MTTR, snapshots: [point(null, 7), point(120, 0)] });
    expect(trend.direction).toBe("unknown");
    expect(trend.delta).toBeNull();
    expect(trend.detail).toContain("0으로 보지 않으므로");
  });

  it("구간에 임계값이 바뀌었으면 색의 변화가 상태의 변화가 아님을 말한다", () => {
    const trend = judgeKpiTrend({
      ...MTTR,
      snapshots: [point(200, 7, 60, 240), point(200, 0, 60, 600)],
    });
    expect(trend.thresholdChanged).toBe(true);
    expect(trend.detail).toContain("임계값이 바뀌었습니다");
    expect(trend.detail).toContain("기준이 움직인 결과");
  });

  it("순서가 뒤섞여 들어와도 시간순으로 비교한다", () => {
    const trend = judgeKpiTrend({ ...MTTR, snapshots: [point(120, 0), point(200, 7)] });
    expect(trend.delta).toBe(-80);
    expect(trend.comparedTo).toBe(NOW - 7 * DAY);
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const trend = judgeKpiTrend({
      ...MTTR,
      snapshots: [point(200, 7, 60, 240), point(100, 0, 60, 600)],
    });
    expect(trend.detail).not.toContain("**");
  });
});

describe("summarizeKpiTrends", () => {
  const titles = { mttr: "평균 복구 시간", mttd: "평균 감지 시간" };

  it("나빠지는 것을 먼저 말한다", () => {
    const worse = judgeKpiTrend({ ...MTTR, snapshots: [point(60, 7), point(200, 0)] });
    const better = judgeKpiTrend({
      ...MTTR,
      kpiId: "mttd",
      snapshots: [
        { ...point(30, 7), kpiId: "mttd" },
        { ...point(10, 0), kpiId: "mttd" },
      ],
    });
    const report = summarizeKpiTrends([better, worse], 7, titles);
    expect(report.worsening).toBe(1);
    expect(report.improving).toBe(1);
    expect(report.detail.indexOf("나빠지는 중")).toBeLessThan(
      report.detail.indexOf("나아지는 중"),
    );
  });

  it("추세를 낼 수 없는 지표 수를 감춘다면 화면을 믿을 수 없다", () => {
    const unknown = judgeKpiTrend({ ...MTTR, snapshots: [point(120, 0)] });
    const report = summarizeKpiTrends([unknown], 7, titles);
    expect(report.unknown).toBe(1);
    expect(report.detail).toContain("추세를 낼 수 없는 지표 1개");
  });

  it("기준이 움직인 지표가 있으면 그 사실을 요약에도 남긴다", () => {
    const shifted = judgeKpiTrend({
      ...MTTR,
      snapshots: [point(200, 7, 60, 240), point(200, 0, 90, 600)],
    });
    const report = summarizeKpiTrends([shifted], 7, titles);
    expect(report.thresholdChanged).toBe(1);
    expect(report.detail).toContain("색의 변화를 상태의 변화로 읽지 마세요");
  });
});

describe("shouldTakeSnapshot", () => {
  it("한 번도 안 찍었으면 찍는다", () => {
    expect(shouldTakeSnapshot(null, NOW)).toBe(true);
  });

  it("오늘 찍었으면 다시 찍지 않는다 — 많이 본 날로 표본이 기운다", () => {
    expect(shouldTakeSnapshot(NOW - 3 * 3_600_000, NOW)).toBe(false);
  });

  it("하루가 지나면 찍는다", () => {
    expect(shouldTakeSnapshot(NOW - DAY, NOW)).toBe(true);
  });
});
