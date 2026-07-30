/**
 * AI 지출 합산. (TASK-3001, Sprint 30 — CTO 결정 2901-④)
 *
 * **예산은 "LLM 지출"이 아니라 "AI 지출 총액"입니다.**
 *
 * 지금까지 예산 상한은 `executions.cost`(LLM)만 봤습니다. OCR을 실 엔진으로
 * 붙이면 **예산 밖에서 돈이 나가는 경로**가 생기고, 상한은 그만큼 무력해집니다.
 * 결정 2901-④에 따라 두 원장(LLM Execution · OCR 실행 이력)을 하나의 지출로
 * 합칩니다.
 *
 * 원장을 **합치지 않고 둘로 유지한 이유**: OCR은 LLM 호출이 아닙니다. 같은
 * 표에 넣으면 토큰·모델·Failover·라우팅 통계에 LLM이 아닌 엔진이 섞이고,
 * Provider 장애 판정도 뒤섞입니다. **지출은 하나로 보고, 원장은 성격대로
 * 나눕니다.**
 */

/** 지출이 나온 원장 */
export const AI_SPEND_SOURCES = ["llm", "ocr"] as const;

export type AiSpendSource = (typeof AI_SPEND_SOURCES)[number];

export interface AiSpendInput {
  /** LLM Execution 비용 합계 (USD) */
  llm: number;
  /** OCR 실행 비용 합계 (USD) */
  ocr: number;
}

export interface AiSpendBreakdown {
  /** 예산과 비교할 총액 */
  total: number;
  bySource: Record<AiSpendSource, number>;
}

/** 합계는 소수 6자리로 맞춘다 (기록과 같은 정밀도) */
function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * 원장별 지출을 합친다 (순수 함수).
 *
 * 음수·NaN은 0으로 본다 — 잘못된 값 때문에 예산이 **낮게** 보이는 것이
 * 가장 위험하다(상한이 늦게 걸린다).
 */
export function combineAiSpend(input: AiSpendInput): AiSpendBreakdown {
  const safe = (value: number): number =>
    Number.isFinite(value) && value > 0 ? value : 0;
  const llm = safe(input.llm);
  const ocr = safe(input.ocr);
  return {
    total: round(llm + ocr),
    bySource: { llm: round(llm), ocr: round(ocr) },
  };
}

/**
 * 지출 구성을 한 줄로.
 *
 * **어느 원장에서 나갔는지 밝힙니다** — 총액만 말하면 "왜 늘었는가"에 답할 수
 * 없고, 예산을 올릴지 OCR 호출을 줄일지 판단할 수 없습니다.
 */
export function describeAiSpend(breakdown: AiSpendBreakdown): string {
  return (
    `AI 지출 $${breakdown.total.toFixed(6)} ` +
    `(LLM $${breakdown.bySource.llm.toFixed(6)} · OCR $${breakdown.bySource.ocr.toFixed(6)})`
  );
}
