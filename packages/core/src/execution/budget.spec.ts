import {
  evaluateBudgetWindow,
  utcDayStart,
  utcMonthStart,
} from "./budget";

describe("LLM 비용 예산 (TASK-0902)", () => {
  it("예산 미설정은 off — 무제한", () => {
    expect(evaluateBudgetWindow(12.5, null)).toEqual({
      budget: null,
      spend: 12.5,
      ratio: null,
      status: "off",
    });
    expect(evaluateBudgetWindow(1, 0).status).toBe("off");
  });

  it("ok → alert(기본 80%) → exceeded(100%) 판정", () => {
    expect(evaluateBudgetWindow(7.9, 10).status).toBe("ok");
    expect(evaluateBudgetWindow(8, 10)).toMatchObject({
      status: "alert",
      ratio: 0.8,
    });
    expect(evaluateBudgetWindow(9.99, 10).status).toBe("alert");
    expect(evaluateBudgetWindow(10, 10).status).toBe("exceeded");
    expect(evaluateBudgetWindow(15, 10).status).toBe("exceeded");
  });

  it("경고 임계는 조정 가능", () => {
    expect(evaluateBudgetWindow(5, 10, 0.5).status).toBe("alert");
    expect(evaluateBudgetWindow(4.9, 10, 0.5).status).toBe("ok");
  });

  it("UTC 일/월 경계 (Execution 시계열 표준과 동일)", () => {
    const now = new Date("2026-07-28T13:45:00.000Z");
    expect(utcDayStart(now).toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(utcMonthStart(now).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
