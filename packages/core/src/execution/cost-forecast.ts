/**
 * 월말 비용 예측. (TASK-3101, Sprint 31 — CTO 정책 3101-③)
 *
 * **Forecast는 운영 참고자료입니다. 예산 차단(Budget Gate)은 실제 비용만
 * 사용합니다.**
 *
 * 그 구분이 이 파일의 전부입니다. 예측으로 호출을 막으면 **아직 쓰지 않은 돈
 * 때문에 서비스가 멈춥니다** — 추정이 틀렸을 때 되돌릴 방법이 없고, "왜 막혔나"에
 * 답할 수도 없습니다. 그래서 이 모듈은 **판단 재료만 만들고 아무것도 막지
 * 않습니다.** 차단 경로(`assertWithinBudget`)는 이 파일을 쓰지 않습니다.
 *
 * 표본이 적으면 **숫자를 만들지 않습니다.** 이틀 관측으로 월말을 말하면 그것은
 * 예측이 아니라 짐작이고, 짐작을 화면에 숫자로 띄우면 사람은 그것을 사실로
 * 다룹니다 — 모르는 것을 모른다고 말하는 것이 이 프로젝트의 기준입니다.
 */

/** 하루 지출 (UTC 일자 기준 — 예산 창과 같은 표준) */
export interface DailySpendPoint {
  /** `YYYY-MM-DD` (UTC) */
  date: string;
  /** 그날의 AI 지출 총액 (LLM + OCR) */
  total: number;
}

export type ForecastVerdict =
  /** 표본이 부족해 판정하지 않았다 */
  | "insufficient"
  /** 관측으로 월말을 추정했다 */
  | "projected";

export interface CostForecast {
  verdict: ForecastVerdict;
  /** 지출이 관측된 일수 (0원인 날도 관측이다) */
  observedDays: number;
  /** 판정에 필요한 최소 일수 */
  minDays: number;
  /** 하루 평균 — 판정하지 않았으면 null */
  dailyAverage: number | null;
  /** 이번 달 현재까지 실제 지출 */
  monthToDate: number;
  /** 월말 예상 지출 — 판정하지 않았으면 null */
  projectedMonthEnd: number | null;
  /** 월 예산 (미설정이면 null) */
  budget: number | null;
  /** 예상/예산 — 어느 쪽이든 없으면 null */
  projectedRatio: number | null;
  /**
   * 예상이 예산을 넘는가 — **표시용입니다.**
   * 이 값으로 호출을 막지 않습니다 (정책 3101-③).
   */
  projectedExceeds: boolean;
  detail: string;
}

/**
 * 판정에 필요한 최소 관측 일수.
 *
 * 고정값입니다 — 환경변수로 열면 "일단 1일로 낮추는" 우회가 생기고, 그러면
 * 하루 관측으로 만든 숫자가 화면에서 예측처럼 보입니다.
 */
export const FORECAST_MIN_DAYS = 3;

/** 예측은 참고자료라는 사실을 문구에 항상 붙인다 */
export const FORECAST_NOTICE =
  "참고용 추정입니다 — 예산 차단은 실제 비용만 사용합니다 (CTO 정책 3101-③).";

function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * 관측된 일별 지출로 월말을 추정한다 (순수 함수).
 *
 * 방식은 **하루 평균 × 이번 달 일수**입니다. 더 정교한 모델(추세·요일 효과)을
 * 쓰지 않은 이유는 표본이 며칠뿐인 구간에서 정교한 모델이 **더 그럴듯하게
 * 틀리기** 때문입니다 — 참고자료로는 단순하고 설명 가능한 값이 낫습니다.
 */
export function forecastMonthlySpend(input: {
  /** 이번 달의 일별 지출 (관측된 날만) */
  points: DailySpendPoint[];
  /** 이번 달 전체 일수 */
  daysInMonth: number;
  /** 월 예산 (미설정이면 null) */
  budget: number | null;
  minDays?: number;
}): CostForecast {
  const minDays = input.minDays ?? FORECAST_MIN_DAYS;
  const observedDays = input.points.length;
  const monthToDate = round(
    input.points.reduce((sum, point) => sum + Math.max(0, point.total), 0),
  );

  if (observedDays < minDays) {
    return {
      verdict: "insufficient",
      observedDays,
      minDays,
      dailyAverage: null,
      monthToDate,
      projectedMonthEnd: null,
      budget: input.budget,
      projectedRatio: null,
      projectedExceeds: false,
      detail:
        `관측 ${observedDays}일 — 예측에는 최소 ${minDays}일이 필요합니다. ` +
        `지금까지 실제 지출은 $${monthToDate.toFixed(6)}입니다. ${FORECAST_NOTICE}`,
    };
  }

  const dailyAverage = round(monthToDate / observedDays);
  const projectedMonthEnd = round(dailyAverage * input.daysInMonth);
  const projectedRatio =
    input.budget !== null && input.budget > 0
      ? round(projectedMonthEnd / input.budget)
      : null;
  const projectedExceeds = projectedRatio !== null && projectedRatio >= 1;

  return {
    verdict: "projected",
    observedDays,
    minDays,
    dailyAverage,
    monthToDate,
    projectedMonthEnd,
    budget: input.budget,
    projectedRatio,
    projectedExceeds,
    detail:
      `관측 ${observedDays}일 · 하루 평균 $${dailyAverage.toFixed(6)} → ` +
      `월말 예상 $${projectedMonthEnd.toFixed(6)}` +
      (input.budget === null
        ? " (월 예산 미설정)"
        : ` / 예산 $${input.budget}` +
          (projectedExceeds
            ? " — 이 추세면 예산을 넘습니다"
            : " — 이 추세면 예산 안에 들어옵니다")) +
      `. ${FORECAST_NOTICE}`,
  };
}
