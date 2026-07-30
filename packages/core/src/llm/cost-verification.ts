import { DEFAULT_LLM_PRICING, estimateLlmCost } from "../execution/execution";
import {
  DEFAULT_OCR_PRICING,
  OCR_UNIT_MODEL,
  estimateOcrCost,
} from "../ocr/ocr-pricing";
import type { OcrUnitPrice } from "../ocr/ocr-pricing";

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

export type CostIssueKind =
  | "unpriced"
  | "mismatch"
  | "missing-usage"
  /**
   * 산정할 수 있었는데 **비용이 기록되지 않았다** (TASK-3001).
   *
   * `null`을 0으로 보고 "기록 $0 vs 기대 $0.003"이라고 말하면 **기록된 값이
   * 다르다**는 뜻이 되어 사실과 어긋납니다 — 기록이 없는 것과 0이 기록된 것은
   * 다릅니다. 라이브 검증에서 이 문구가 오해를 만드는 것을 확인해 갈랐습니다.
   */
  | "unrecorded";

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

/**
 * 가격표 또는 **시점별 가격표 해석 함수** (TASK-3101, CTO 정책 3101-①②).
 *
 * 단가가 절차를 거쳐 바뀌면, 그 뒤로 과거 기록을 그냥 새 단가로 대조하면
 * **과거 전체가 "불일치"로 보고**됩니다. 비용 기록은 수정하지 않으므로
 * (Append Only, 정책 3101-②) 검증은 **그 시점에 유효했던 단가**로 물어야
 * 합니다 — 그래서 함수를 받습니다.
 */
export type LlmPricingResolver =
  | typeof DEFAULT_LLM_PRICING
  | ((at: string) => typeof DEFAULT_LLM_PRICING);

export type OcrPricingResolver =
  | Record<string, OcrUnitPrice>
  | ((at: string) => Record<string, OcrUnitPrice>);

/** 표본 시점의 가격표를 고른다 */
function tableFor<T>(resolver: T | ((at: string) => T), at: string): T {
  return typeof resolver === "function"
    ? (resolver as (at: string) => T)(at)
    : resolver;
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
  pricing: LlmPricingResolver = DEFAULT_LLM_PRICING,
): CostVerificationResult {
  const unpriced = new Map<string, CostSample[]>();
  const mismatched = new Map<string, CostSample[]>();
  const missingUsage = new Map<string, CostSample[]>();
  const unrecorded = new Map<string, CostSample[]>();

  let recordedTotal = 0;
  let expectedTotal = 0;
  let unpricedCalls = 0;

  for (const sample of samples) {
    recordedTotal += sample.cost ?? 0;

    const expected = estimateLlmCost(
      sample.model,
      { inputTokens: sample.inputTokens, outputTokens: sample.outputTokens },
      tableFor(pricing, sample.createdAt),
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
    if (sample.cost === null) {
      // 기록이 없는 것과 0이 기록된 것은 다르다 (TASK-3001)
      unrecorded.set(key, [...(unrecorded.get(key) ?? []), sample]);
      continue;
    }
    if (Math.abs(sample.cost - expected) > TOLERANCE) {
      mismatched.set(key, [...(mismatched.get(key) ?? []), sample]);
    }
  }

  const issues: CostIssue[] = [];

  for (const [key, group] of unrecorded) {
    const [provider, model] = key.split("|");
    issues.push({
      kind: "unrecorded",
      provider,
      model,
      count: group.length,
      message:
        "산정할 수 있는 호출인데 비용이 기록되지 않았습니다 — 이 기능을 켜기 전의 " +
        "실행이거나 기록이 실패한 경우입니다. 예산 합계에서 빠집니다.",
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
      expectedTotal: round(
        group.reduce(
          (sum, sample) =>
            sum +
            (estimateLlmCost(
              sample.model,
              {
                inputTokens: sample.inputTokens,
                outputTokens: sample.outputTokens,
              },
              tableFor(pricing, sample.createdAt),
            ) ?? 0),
          0,
        ),
      ),
    });
  }

  for (const [key, group] of unpriced) {
    const [provider, model] = key.split("|");
    issues.push({
      kind: "unpriced",
      provider,
      model,
      count: group.length,
      message:
        `가격표에 없는 모델입니다 — 비용이 집계되지 않아 예산 상한이 적용되지 않습니다. ` +
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
          tableFor(pricing, sample.createdAt),
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

// ── OCR 비용 검증 (TASK-3001, CTO 결정 2901-④) ─────────────

/** OCR 실행 1건의 비용 표본 */
export interface OcrCostSample {
  /** OCR 실행 식별자 (보고용) */
  id: string;
  provider: string;
  /** 과금 단위 수 (이미지 1장 = 1) */
  units: number;
  /** 기록된 비용 (USD) — null이면 미산정 */
  cost: number | null;
  createdAt: string;
}

/**
 * OCR 비용을 가격표로 재계산해 검증한다 (순수 함수).
 *
 * LLM 검증과 **같은 결과 모양**을 돌려줍니다 — 화면과 경보가 둘을 같은
 * 방식으로 다뤄야 하고(결정 2901-④: 동일하게 편입), 모양이 갈라지면 한쪽만
 * 보이는 사각이 생깁니다.
 *
 * `missing-usage`는 없습니다 — OCR은 토큰이 아니라 단위 수로 세고, 단위 수는
 * 항상 있습니다. 대신 **가격표에 없는 Provider**가 미산정입니다: 그 상태에서는
 * 비용이 예산 계산에서 빠지므로 상한이 조용히 무력해집니다.
 */
export function verifyOcrCosts(
  samples: OcrCostSample[],
  pricing: OcrPricingResolver = DEFAULT_OCR_PRICING,
): CostVerificationResult {
  const unpriced = new Map<string, OcrCostSample[]>();
  const mismatched = new Map<string, OcrCostSample[]>();
  const unrecorded = new Map<string, OcrCostSample[]>();

  let recordedTotal = 0;
  let expectedTotal = 0;
  let unpricedCalls = 0;

  for (const sample of samples) {
    recordedTotal += sample.cost ?? 0;
    const expected = estimateOcrCost(
      sample.provider,
      sample.units,
      tableFor(pricing, sample.createdAt),
    );
    const key = sample.provider;

    if (expected === null) {
      unpricedCalls += 1;
      unpriced.set(key, [...(unpriced.get(key) ?? []), sample]);
      continue;
    }

    expectedTotal += expected;
    if (sample.cost === null) {
      // 기록이 없는 것과 0이 기록된 것은 다르다 (TASK-3001)
      unrecorded.set(key, [...(unrecorded.get(key) ?? []), sample]);
      continue;
    }
    if (Math.abs(sample.cost - expected) > TOLERANCE) {
      mismatched.set(key, [...(mismatched.get(key) ?? []), sample]);
    }
  }

  const issues: CostIssue[] = [];

  for (const [provider, group] of unrecorded) {
    issues.push({
      kind: "unrecorded",
      provider,
      model: OCR_UNIT_MODEL,
      count: group.length,
      message:
        "산정할 수 있는 OCR 실행인데 비용이 기록되지 않았습니다 — 비용 편입 " +
        "이전의 실행이거나 기록이 실패한 경우입니다. 예산 합계에서 빠집니다.",
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
      expectedTotal: round(
        group.reduce(
          (sum, sample) =>
            sum +
            (estimateOcrCost(
              sample.provider,
              sample.units,
              tableFor(pricing, sample.createdAt),
            ) ?? 0),
          0,
        ),
      ),
    });
  }

  for (const [provider, group] of unpriced) {
    issues.push({
      kind: "unpriced",
      provider,
      model: OCR_UNIT_MODEL,
      count: group.length,
      message:
        "가격표에 없는 OCR 엔진입니다 — 비용이 집계되지 않아 예산 상한이 " +
        `적용되지 않습니다. DEFAULT_OCR_PRICING에 ${provider} 단가를 등록하세요.`,
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
    });
  }

  for (const [provider, group] of mismatched) {
    const recorded = group.reduce((sum, sample) => sum + (sample.cost ?? 0), 0);
    const expected = group.reduce(
      (sum, sample) =>
        sum +
        (estimateOcrCost(
          sample.provider,
          sample.units,
          tableFor(pricing, sample.createdAt),
        ) ?? 0),
      0,
    );
    issues.push({
      kind: "mismatch",
      provider,
      model: OCR_UNIT_MODEL,
      count: group.length,
      message:
        "기록된 OCR 비용이 가격표 재계산과 다릅니다 — 단가가 바뀌었거나 기록 " +
        `시점 가격표가 달랐을 수 있습니다 (기록 $${round(recorded)} vs 기대 $${round(expected)}).`,
      sampleIds: group.slice(0, 3).map((sample) => sample.id),
      recordedTotal: round(recorded),
      expectedTotal: round(expected),
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
