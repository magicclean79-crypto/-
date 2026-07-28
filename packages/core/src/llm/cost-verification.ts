import { DEFAULT_LLM_PRICING, estimateLlmCost } from "../execution/execution";

/**
 * Cost Verification. (TASK-1301, Sprint 13)
 *
 * 실제 Provider로 운영하면 **비용이 실제로 나간다**. 기록된 비용이 가격표와
 * 맞는지, 가격표가 없는 모델로 조용히 호출되고 있지는 않은지를 검증한다.
 *
 * 검증하는 것:
 * - **미산정**: 가격표에 없는 모델 → 비용이 null로 남아 예산 계산에서 빠진다
 *   (예산 상한이 무력화되므로 운영에서 가장 위험한 상태)
 * - **불일치**: 기록된 비용과 토큰·단가로 다시 계산한 값이 다름
 * - **토큰 누락**: usage가 없어 비용을 산정할 수 없었던 호출
 */

export interface CostSample {
  /** Execution 식별자 (보고용) */
  id: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** 기록된 비용 (USD) — null이면 미산정 */
  cost: number | null;
  createdAt: string;
}

export type CostIssueKind = "unpriced" | "mismatch" | "missing-usage";

export interface CostIssue {
  kind: CostIssueKind;
  model: string;
  provider: string;
  /** 해당 문제를 가진 호출 수 */
  count: number;
  /** 사람이 읽는 설명 */
  message: string;
  /** 대표 예시 (Execution id) */
  sampleIds: string[];
  /** mismatch일 때: 기록값·기대값 합계 */
  recordedTotal?: number;
  expectedTotal?: number;
}

export interface CostVerificationResult {
  /** 문제가 하나도 없으면 true */
  ok: boolean;
  checked: number;
  /** 가격표가 없어 비용이 집계되지 않은 호출 수 */
  unpricedCalls: number;
  /** 기록된 비용 합계 (USD) */
  recordedTotal: number;
  /** 다시 계산한 비용 합계 (USD) — 산정 가능한 것만 */
  expectedTotal: number;
  issues: CostIssue[];
}

/** 부동소수 비교 허용 오차 (기록은 소수 6자리로 반올림된다) */
const TOLERANCE = 0.000_002;

function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * 기록된 비용을 가격표로 재계산해 검증한다.
 * 순수 함수 — 입력은 Execution 표본, 출력은 문제 목록과 합계.
 */
export function verifyCosts(
  samples: CostSample[],
  pricing: typeof DEFAULT_LLM_PRICING = DEFAULT_LLM_PRICING,
): CostVerificationResult {
  const unpriced = new Map<string, CostSample[]>();
  const mismatched = new Map<string, CostSample[]>();
  const missingUsage = new Map<string, CostSample[]>();

  let recordedTotal = 0;
  let expectedTotal = 0;
  let unpricedCalls = 0;

  for (const sample of samples) {
    recordedTotal += sample.cost ?? 0;

    const expected = estimateLlmCost(
      sample.model,
      { inputTokens: sample.inputTokens, outputTokens: sample.outputTokens },
      pricing,
    );
    const key = `${sample.provider}|${sample.model}`;

    if (expected === null) {
      // 토큰이 없어서인지, 가격표가 없어서인지 구분한다 — 조치가 다르다
      const hasUsage =
        sample.inputTokens !== null && sample.outputTokens !== null;
      if (hasUsage) {
        unpricedCalls += 1;
        unpriced.set(key, [...(unpriced.get(key) ?? []), sample]);
      } else {
        missingUsage.set(key, [...(missingUsage.get(key) ?? []), sample]);
      }
      continue;
    }

    expectedTotal += expected;
    if (Math.abs((sample.cost ?? 0) - expected) > TOLERANCE) {
      mismatched.set(key, [...(mismatched.get(key) ?? []), sample]);
    }
  }

  const issues: CostIssue[] = [];

  for (const [key, group] of unpriced) {
    const [provider, model] = key.split("|");
    issues.push({
      kind: "unpriced",
      provider,
      model,
      count: group.length,
      message:
        `가격표에 없는 모델입니다 — 비용이 집계되지 않아 **예산 상한이 적용되지 않습니다**. ` +
        `DEFAULT_LLM_PRICING에 ${model} 단가를 등록하세요.`,
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
    });
  }

  for (const [key, group] of mismatched) {
    const [provider, model] = key.split("|");
    const recorded = group.reduce((sum, sample) => sum + (sample.cost ?? 0), 0);
    const expected = group.reduce(
      (sum, sample) =>
        sum +
        (estimateLlmCost(
          sample.model,
          { inputTokens: sample.inputTokens, outputTokens: sample.outputTokens },
          pricing,
        ) ?? 0),
      0,
    );
    issues.push({
      kind: "mismatch",
      provider,
      model,
      count: group.length,
      message:
        `기록된 비용이 가격표 재계산과 다릅니다 — 단가가 바뀌었거나 기록 시점 ` +
        `가격표가 달랐을 수 있습니다 (기록 $${round(recorded)} vs 기대 $${round(expected)}).`,
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
      recordedTotal: round(recorded),
      expectedTotal: round(expected),
    });
  }

  for (const [key, group] of missingUsage) {
    const [provider, model] = key.split("|");
    issues.push({
      kind: "missing-usage",
      provider,
      model,
      count: group.length,
      message:
        "토큰 사용량이 없어 비용을 산정할 수 없었습니다 — Provider 응답에 usage가 " +
        "없거나 호출이 실패한 경우입니다.",
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
    });
  }

  return {
    ok: issues.length === 0,
    checked: samples.length,
    unpricedCalls,
    recordedTotal: round(recordedTotal),
    expectedTotal: round(expectedTotal),
    issues,
  };
}

/** 가격표에 단가가 등록된 모델 목록 (표시용) */
export function pricedModels(
  pricing: typeof DEFAULT_LLM_PRICING = DEFAULT_LLM_PRICING,
): { model: string; inputPerMillion: number; outputPerMillion: number }[] {
  return Object.entries(pricing).map(([model, price]) => ({
    model,
    ...price,
  }));
}
