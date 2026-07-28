/**
 * LLM 비용 예산 도메인 로직. (TASK-0902, Sprint 9 — Cost Governance)
 *
 * Execution cost(USD) 합계를 일/월 예산과 비교해 상태를 판정한다.
 * 예산 미설정(null)은 "off" — 무제한(기존 동작 유지, 오버헤드 없음).
 * 경계는 UTC 기준(Execution 시계열과 동일 표준, TASK-0605 승인 ①).
 */

export type BudgetStatus = "off" | "ok" | "alert" | "exceeded";

export interface BudgetWindowStatus {
  /** 설정된 예산 (USD) — 미설정이면 null */
  budget: number | null;
  /** 기간 내 지출 합계 (USD) */
  spend: number;
  /** spend/budget (예산 미설정이면 null) */
  ratio: number | null;
  status: BudgetStatus;
}

/** 경고 임계 기본값 — 예산의 80% 도달 시 alert */
export const DEFAULT_BUDGET_ALERT_RATIO = 0.8;

export function evaluateBudgetWindow(
  spend: number,
  budget: number | null,
  alertRatio: number = DEFAULT_BUDGET_ALERT_RATIO,
): BudgetWindowStatus {
  if (budget === null || !(budget > 0)) {
    return { budget: null, spend, ratio: null, status: "off" };
  }
  const ratio = spend / budget;
  return {
    budget,
    spend,
    ratio,
    status: ratio >= 1 ? "exceeded" : ratio >= alertRatio ? "alert" : "ok",
  };
}

/** UTC 당일 00:00 */
export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** UTC 당월 1일 00:00 */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
