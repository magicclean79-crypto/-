import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORECAST_MIN_DAYS,
  FORECAST_NOTICE,
  forecastMonthlySpend,
} from "./cost-forecast";
import type { DailySpendPoint } from "./cost-forecast";

const days = (values: number[]): DailySpendPoint[] =>
  values.map((total, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    total,
  }));

describe("비용 예측 (TASK-3101, CTO 정책 3101-③)", () => {
  describe("표본이 적으면 숫자를 만들지 않는다", () => {
    it("최소 일수는 고정값이다", () => {
      // 환경변수로 열면 "일단 1일로 낮추는" 우회가 생기고, 하루 관측으로 만든
      // 숫자가 화면에서 예측처럼 보인다
      expect(FORECAST_MIN_DAYS).toBe(3);
      const code = readFileSync(join(__dirname, "cost-forecast.ts"), "utf8");
      expect(code).not.toContain("process.env");
    });

    it("2일 관측으로는 월말을 말하지 않는다", () => {
      const forecast = forecastMonthlySpend({
        points: days([1, 2]),
        daysInMonth: 31,
        budget: 100,
      });
      expect(forecast.verdict).toBe("insufficient");
      expect(forecast.projectedMonthEnd).toBeNull();
      expect(forecast.dailyAverage).toBeNull();
      expect(forecast.projectedRatio).toBeNull();
      // 실제 지출은 사실이므로 그대로 말한다
      expect(forecast.monthToDate).toBe(3);
      expect(forecast.detail).toContain("최소 3일이 필요합니다");
    });

    it("관측이 없어도 실패가 아니다 — 아직 모르는 것이다", () => {
      const forecast = forecastMonthlySpend({
        points: [],
        daysInMonth: 30,
        budget: null,
      });
      expect(forecast.verdict).toBe("insufficient");
      expect(forecast.observedDays).toBe(0);
      expect(forecast.monthToDate).toBe(0);
    });
  });

  describe("추정", () => {
    it("하루 평균 × 이번 달 일수로 월말을 추정한다", () => {
      const forecast = forecastMonthlySpend({
        points: days([1, 2, 3]),
        daysInMonth: 31,
        budget: 100,
      });
      expect(forecast.verdict).toBe("projected");
      expect(forecast.dailyAverage).toBe(2);
      expect(forecast.projectedMonthEnd).toBe(62);
      expect(forecast.projectedRatio).toBe(0.62);
      expect(forecast.projectedExceeds).toBe(false);
    });

    it("예상이 예산을 넘으면 그 사실을 말한다 — 다만 표시용이다", () => {
      const forecast = forecastMonthlySpend({
        points: days([10, 10, 10]),
        daysInMonth: 30,
        budget: 100,
      });
      expect(forecast.projectedMonthEnd).toBe(300);
      expect(forecast.projectedExceeds).toBe(true);
      expect(forecast.detail).toContain("이 추세면 예산을 넘습니다");
    });

    it("예산이 없으면 비율을 말하지 않는다", () => {
      const forecast = forecastMonthlySpend({
        points: days([1, 1, 1]),
        daysInMonth: 30,
        budget: null,
      });
      expect(forecast.projectedRatio).toBeNull();
      expect(forecast.projectedExceeds).toBe(false);
      expect(forecast.detail).toContain("월 예산 미설정");
    });

    it("0원인 날도 관측이다 — 안 쓴 것과 모르는 것은 다르다", () => {
      const forecast = forecastMonthlySpend({
        points: days([0, 0, 0]),
        daysInMonth: 30,
        budget: 10,
      });
      expect(forecast.verdict).toBe("projected");
      expect(forecast.projectedMonthEnd).toBe(0);
    });

    it("음수 지출은 0으로 본다 — 예산이 낮게 보이는 것이 더 위험하다", () => {
      const forecast = forecastMonthlySpend({
        points: days([-5, 3, 3]),
        daysInMonth: 30,
        budget: null,
      });
      expect(forecast.monthToDate).toBe(6);
    });
  });

  describe("참고자료라는 사실을 항상 밝힌다", () => {
    it("모든 판정의 문구에 안내가 붙는다", () => {
      for (const points of [days([1]), days([1, 2, 3])]) {
        const forecast = forecastMonthlySpend({
          points,
          daysInMonth: 30,
          budget: 50,
        });
        expect(forecast.detail).toContain(FORECAST_NOTICE);
        expect(forecast.detail).toContain("예산 차단은 실제 비용만 사용합니다");
      }
    });

    it("예측 모듈은 차단에 쓰이지 않는다 — 예산 관문이 이 파일을 모른다", () => {
      // 예측으로 호출을 막으면 아직 쓰지 않은 돈 때문에 서비스가 멈춘다
      const budget = readFileSync(join(__dirname, "budget.ts"), "utf8");
      expect(budget).not.toContain("forecast");
      expect(budget).not.toContain("Forecast");
    });

    it("마크다운 강조가 새지 않는다", () => {
      expect(
        forecastMonthlySpend({ points: days([1, 1, 1]), daysInMonth: 30, budget: 1 })
          .detail,
      ).not.toContain("**");
    });
  });
});
