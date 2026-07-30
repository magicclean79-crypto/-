/**
 * 운영 비용 리포트. (TASK-3101, Sprint 31 — CTO 정책 3101-④)
 *
 * **이 리포트는 운영 지표입니다. 회계 청구서를 대체하지 않습니다.**
 *
 * 우리 숫자는 **우리가 계산한 추정**입니다. 실제 청구와 다를 수 있는 이유가
 * 최소 넷 있습니다:
 *
 * - **미산정**: 가격표에 없는 모델·엔진은 비용이 `null`이라 합계에서 빠집니다
 *   — 그만큼 우리 총액은 **작습니다.**
 * - **실패한 호출**: Provider에 따라 과금될 수 있는데 우리는 비용을 적지
 *   않습니다 — 이 역시 우리 총액이 작아지는 방향입니다.
 * - **무료 구간**: 반영하지 않으므로(TASK-3001) 그 구간에서는 우리 총액이
 *   **큽니다.**
 * - **단가 변동·환율·세금**: 청구서에는 있고 우리에게는 없습니다.
 *
 * 그래서 리포트는 총액 옆에 **항상 이 사실을 적습니다.** 숫자만 있으면 누군가
 * 그것을 청구서로 다루고, 회계와 어긋나는 순간 신뢰를 잃습니다.
 */

import { AI_SPEND_SOURCES, type AiSpendSource } from "./ai-spend";

/** 리포트에 항상 붙는 문구 (정책 3101-④) */
export const BILLING_DISCLAIMER =
  "이 리포트는 운영 지표입니다 — 회계 청구서를 대체하지 않습니다. " +
  "미산정·실패 호출·무료 구간·환율 차이로 실제 청구와 다를 수 있습니다.";

/** 집계 입력 1건 (원장에서 읽어온 그룹) */
export interface BillingGroupInput {
  source: AiSpendSource;
  provider: string;
  /** LLM은 모델, OCR은 `text-detection` */
  model: string;
  calls: number;
  /** 비용 합계 (USD) — 미산정만 있으면 null */
  cost: number | null;
  /** 비용이 없는(미산정·미기록) 호출 수 */
  unpricedCalls: number;
}

export interface BillingRow extends BillingGroupInput {
  /** 총액 대비 비중 (총액이 0이면 null — 0으로 나눌 수 없다) */
  share: number | null;
}

export interface BillingReport {
  period: { from: string; to: string };
  /** 원장 합산 총액 */
  total: number;
  bySource: Record<AiSpendSource, number>;
  /** 큰 것부터 */
  rows: BillingRow[];
  calls: number;
  /**
   * 비용이 빠진 호출 수.
   *
   * 0이 아니면 **총액이 실제보다 작습니다** — 그 사실을 문구가 말합니다.
   */
  unpricedCalls: number;
  disclaimer: string;
  detail: string;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * 기간 집계를 리포트로 (순수 함수).
 *
 * 정렬은 **비용 큰 것부터**입니다 — 리포트를 여는 이유는 대개 "무엇이 돈을
 * 쓰는가"이고, 이름순으로 두면 매번 눈으로 찾아야 합니다.
 */
export function buildBillingReport(input: {
  from: Date;
  to: Date;
  groups: BillingGroupInput[];
}): BillingReport {
  const bySource = Object.fromEntries(
    AI_SPEND_SOURCES.map((source) => [source, 0]),
  ) as Record<AiSpendSource, number>;

  let total = 0;
  let calls = 0;
  let unpricedCalls = 0;

  for (const group of input.groups) {
    const cost = group.cost ?? 0;
    total += cost;
    bySource[group.source] = round(bySource[group.source] + cost);
    calls += group.calls;
    unpricedCalls += group.unpricedCalls;
  }
  total = round(total);

  const rows: BillingRow[] = input.groups
    .map((group) => ({
      ...group,
      // 총액이 0이면 비중을 말할 수 없다 — 0%로 적으면 "안 썼다"로 읽힌다
      share: total > 0 ? round((group.cost ?? 0) / total) : null,
    }))
    .sort(
      (a, b) =>
        (b.cost ?? 0) - (a.cost ?? 0) ||
        b.calls - a.calls ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    );

  return {
    period: { from: input.from.toISOString(), to: input.to.toISOString() },
    total,
    bySource,
    rows,
    calls,
    unpricedCalls,
    disclaimer: BILLING_DISCLAIMER,
    detail: describeBillingReport({ total, calls, unpricedCalls, bySource }),
  };
}

/** 한 줄 요약 — 총액이 작을 수 있다는 사실을 숨기지 않는다 */
export function describeBillingReport(summary: {
  total: number;
  calls: number;
  unpricedCalls: number;
  bySource: Record<AiSpendSource, number>;
}): string {
  const head =
    `호출 ${summary.calls}건 · 합계 $${summary.total.toFixed(6)} ` +
    `(LLM $${summary.bySource.llm.toFixed(6)} · OCR $${summary.bySource.ocr.toFixed(6)})`;
  const gap =
    summary.unpricedCalls > 0
      ? ` 비용이 빠진 호출 ${summary.unpricedCalls}건이 있어 **합계는 실제보다 작습니다.**`
      : "";
  // 마크다운 강조는 쓰지 않는다 — Slack·메일·화면에서 별표가 그대로 보인다
  return `${head}.${gap.replace(/\*\*/g, "")} ${BILLING_DISCLAIMER}`;
}
