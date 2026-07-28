/**
 * Experiment Analytics & Recommendation. (TASK-1102, Sprint 11)
 *
 * 실험이 끝났는지, 어느 변형이 나은지를 **판단 근거와 함께** 제시한다.
 * 승격 자체는 운영자의 수동 절차이므로(CTO 결정 1101-③), 여기서는
 * "무엇을 근거로 그렇게 보이는지"를 숫자로 드러내는 데 집중한다.
 *
 * 원칙:
 * - **품질 우선**: 성공률 차이가 통계적으로 유의하면 그것이 승자다.
 *   비용이 싸도 실패하는 변형은 이기지 못한다.
 * - **동률이면 비용 → 지연**: 성공률이 통계적으로 구분되지 않을 때만
 *   비용(호출당)과 지연으로 판단한다.
 * - **표본이 모자라면 추천하지 않는다**: 근거 없는 추천은 해롭다.
 * - 모든 추천에 **신뢰도(0~1)와 사람이 읽을 근거**를 붙인다.
 */

/** 승자 추천에 필요한 변형별 최소 호출 수 (기본값) */
export const MIN_SAMPLES_FOR_RECOMMENDATION = 30;

/** 성공률 차이를 "유의하다"고 볼 신뢰도 임계 */
export const SIGNIFICANCE_THRESHOLD = 0.95;

/** Execution 집계에서 뽑은 변형 1개의 원시 표본 */
export interface VariantSample {
  key: string;
  provider: string;
  model: string | null;
  calls: number;
  successes: number;
  failures: number;
  /** 전체 호출 평균 지연(ms) — 표본이 없으면 null */
  avgLatencyMs: number | null;
  /** 합계 비용(USD) — 가격표가 없는 모델은 null */
  cost: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface VariantPerformance extends VariantSample {
  /** 성공률 (호출이 없으면 null) */
  successRate: number | null;
  /** 호출당 비용(USD) — 비용·호출이 없으면 null */
  costPerCall: number | null;
  /** 설정된 배정 가중치 비율 (표시용, 없으면 null) */
  weightShare: number | null;
  /** Wilson 95% 신뢰구간 — 표본이 적을 때 성공률을 과신하지 않기 위해 */
  successRateInterval: [number, number] | null;
}

/** 표준정규 누적분포 — erf 근사(Abramowitz & Stegun 7.1.26) */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * 이항 비율의 Wilson 신뢰구간. 표본이 작을 때 정규근사(Wald)보다 안정적이라
 * "3/3 성공 = 100%"처럼 과신하는 표시를 막는다.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96,
): [number, number] | null {
  if (total <= 0) {
    return null;
  }
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const spread =
    z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [
    Math.max(0, (center - spread) / denominator),
    Math.min(1, (center + spread) / denominator),
  ];
}

/**
 * 두 비율이 다르다고 볼 신뢰도 (양측 2-비율 z검정, 0~1).
 * 표본이 없거나 완전히 동일하면 0.
 */
export function proportionConfidence(
  a: { successes: number; total: number },
  b: { successes: number; total: number },
): number {
  if (a.total <= 0 || b.total <= 0) {
    return 0;
  }
  const pooled = (a.successes + b.successes) / (a.total + b.total);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / a.total + 1 / b.total),
  );
  if (!(standardError > 0)) {
    return 0;
  }
  const z = Math.abs(a.successes / a.total - b.successes / b.total) / standardError;
  // 양측 검정: 2·Φ(z) − 1
  return Math.min(1, Math.max(0, 2 * normalCdf(z) - 1));
}

export interface VariantComparison {
  key: string;
  /** 기준(baseline) 대비 성공률 차이 (비율 포인트, +면 우세) */
  successRateDelta: number | null;
  /** 기준 대비 평균 지연 차이(ms, −면 빠름) */
  latencyDelta: number | null;
  /** 기준 대비 호출당 비용 차이(USD, −면 저렴) */
  costPerCallDelta: number | null;
  /** 성공률 차이가 우연이 아닐 신뢰도 (0~1) */
  successRateConfidence: number;
}

export type RecommendationBasis =
  | "success-rate"
  | "cost"
  | "latency"
  | "insufficient-data"
  | "no-variants";

export interface WinnerRecommendation {
  /** 추천 변형 (판단 불가면 null) */
  winner: string | null;
  /** 판단 근거 종류 */
  basis: RecommendationBasis;
  /** 신뢰도 0~1 — 근거가 성공률이면 검정 결과, 그 외는 표본 충분도 기반 */
  confidence: number;
  /** 사람이 읽는 근거 설명 */
  reason: string;
  /** 추천을 확정으로 볼 수 있는지 (신뢰도 임계 이상) */
  conclusive: boolean;
}

export interface AnalyticsInput {
  samples: VariantSample[];
  /** 변형별 설정 가중치 비율 (표시용) */
  weightShares?: Record<string, number>;
  /** 변형별 최소 호출 수 (기본 30) */
  minSamples?: number;
}

export interface AnalyticsResult {
  variants: VariantPerformance[];
  /** 비교 기준 변형 — 가중치가 가장 큰 변형(동률이면 첫 번째) */
  baseline: string | null;
  comparisons: VariantComparison[];
  recommendation: WinnerRecommendation;
  totalCalls: number;
}

function toPerformance(
  sample: VariantSample,
  weightShare: number | null,
): VariantPerformance {
  return {
    ...sample,
    weightShare,
    successRate: sample.calls > 0 ? sample.successes / sample.calls : null,
    costPerCall:
      sample.cost !== null && sample.calls > 0 ? sample.cost / sample.calls : null,
    successRateInterval: wilsonInterval(sample.successes, sample.calls),
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * 변형별 성과 요약 + 비교 + 승자 추천.
 * 순수 함수 — 입력은 Execution 집계 결과, 출력은 표시·판단에 필요한 값 전부.
 */
export function analyzeExperiment(input: AnalyticsInput): AnalyticsResult {
  const minSamples = input.minSamples ?? MIN_SAMPLES_FOR_RECOMMENDATION;
  const variants = input.samples.map((sample) =>
    toPerformance(sample, input.weightShares?.[sample.key] ?? null),
  );
  const totalCalls = variants.reduce((sum, variant) => sum + variant.calls, 0);

  if (variants.length === 0) {
    return {
      variants,
      baseline: null,
      comparisons: [],
      recommendation: {
        winner: null,
        basis: "no-variants",
        confidence: 0,
        reason: "비교할 변형이 없습니다.",
        conclusive: false,
      },
      totalCalls: 0,
    };
  }

  // 기준은 가중치가 가장 큰 변형 (대개 baseline/control)
  const baselineVariant = [...variants].sort(
    (a, b) => (b.weightShare ?? 0) - (a.weightShare ?? 0),
  )[0];
  const comparisons: VariantComparison[] = variants
    .filter((variant) => variant.key !== baselineVariant.key)
    .map((variant) => ({
      key: variant.key,
      successRateDelta:
        variant.successRate !== null && baselineVariant.successRate !== null
          ? variant.successRate - baselineVariant.successRate
          : null,
      latencyDelta:
        variant.avgLatencyMs !== null && baselineVariant.avgLatencyMs !== null
          ? variant.avgLatencyMs - baselineVariant.avgLatencyMs
          : null,
      costPerCallDelta:
        variant.costPerCall !== null && baselineVariant.costPerCall !== null
          ? variant.costPerCall - baselineVariant.costPerCall
          : null,
      successRateConfidence: proportionConfidence(
        { successes: variant.successes, total: variant.calls },
        {
          successes: baselineVariant.successes,
          total: baselineVariant.calls,
        },
      ),
    }));

  return {
    variants,
    baseline: baselineVariant.key,
    comparisons,
    recommendation: recommendWinner(variants, minSamples),
    totalCalls,
  };
}

/**
 * 승자 추천.
 *
 * 1. 모든 변형이 최소 표본을 채워야 한다 — 아니면 추천하지 않는다
 * 2. 성공률 1위와 2위의 차이가 유의하면(신뢰도 ≥ 임계) 1위가 승자
 * 3. 성공률이 통계적으로 구분되지 않으면 **호출당 비용**이 싼 쪽
 * 4. 비용도 같으면 **평균 지연**이 짧은 쪽
 */
export function recommendWinner(
  variants: VariantPerformance[],
  minSamples: number = MIN_SAMPLES_FOR_RECOMMENDATION,
): WinnerRecommendation {
  if (variants.length === 0) {
    return {
      winner: null,
      basis: "no-variants",
      confidence: 0,
      reason: "비교할 변형이 없습니다.",
      conclusive: false,
    };
  }
  if (variants.length === 1) {
    return {
      winner: variants[0].key,
      basis: "insufficient-data",
      confidence: 0,
      reason:
        "변형이 하나뿐이라 비교할 대상이 없습니다 — 실험이라기보다 단일 경로입니다.",
      conclusive: false,
    };
  }

  const short = variants.filter((variant) => variant.calls < minSamples);
  if (short.length > 0) {
    return {
      winner: null,
      basis: "insufficient-data",
      confidence: 0,
      reason:
        `표본이 부족합니다 — 변형당 최소 ${minSamples}회가 필요한데 ` +
        short
          .map((variant) => `${variant.key} ${variant.calls}회`)
          .join(", ") +
        "입니다. 더 모은 뒤 다시 확인하세요.",
      conclusive: false,
    };
  }

  const ranked = [...variants].sort(
    (a, b) => (b.successRate ?? 0) - (a.successRate ?? 0),
  );
  const [best, runnerUp] = ranked;
  const confidence = proportionConfidence(
    { successes: best.successes, total: best.calls },
    { successes: runnerUp.successes, total: runnerUp.calls },
  );

  if (confidence >= SIGNIFICANCE_THRESHOLD) {
    return {
      winner: best.key,
      basis: "success-rate",
      confidence,
      reason:
        `성공률이 ${best.key} ${formatPercent(best.successRate ?? 0)} vs ` +
        `${runnerUp.key} ${formatPercent(runnerUp.successRate ?? 0)}로, ` +
        `이 차이가 우연일 가능성은 낮습니다 (신뢰도 ${formatPercent(confidence)}).`,
      conclusive: true,
    };
  }

  // 성공률이 통계적으로 구분되지 않음 → 비용, 그다음 지연
  const priced = variants.filter((variant) => variant.costPerCall !== null);
  if (priced.length === variants.length) {
    const byCost = [...priced].sort(
      (a, b) => (a.costPerCall ?? 0) - (b.costPerCall ?? 0),
    );
    const [cheapest, next] = byCost;
    if ((cheapest.costPerCall ?? 0) < (next.costPerCall ?? 0)) {
      return {
        winner: cheapest.key,
        basis: "cost",
        confidence,
        reason:
          `성공률 차이는 통계적으로 뚜렷하지 않습니다 (신뢰도 ${formatPercent(confidence)}). ` +
          `호출당 비용이 ${cheapest.key} $${(cheapest.costPerCall ?? 0).toFixed(6)}로 ` +
          `${next.key} $${(next.costPerCall ?? 0).toFixed(6)}보다 저렴합니다.`,
        conclusive: false,
      };
    }
  }

  const timed = variants.filter((variant) => variant.avgLatencyMs !== null);
  if (timed.length === variants.length) {
    const byLatency = [...timed].sort(
      (a, b) => (a.avgLatencyMs ?? 0) - (b.avgLatencyMs ?? 0),
    );
    const [fastest, next] = byLatency;
    if ((fastest.avgLatencyMs ?? 0) < (next.avgLatencyMs ?? 0)) {
      return {
        winner: fastest.key,
        basis: "latency",
        confidence,
        reason:
          `성공률·비용 차이가 뚜렷하지 않아 지연으로 판단했습니다 — ` +
          `${fastest.key} ${Math.round(fastest.avgLatencyMs ?? 0)}ms가 ` +
          `${next.key} ${Math.round(next.avgLatencyMs ?? 0)}ms보다 빠릅니다.`,
        conclusive: false,
      };
    }
  }

  return {
    winner: null,
    basis: "insufficient-data",
    confidence,
    reason:
      `성공률·비용·지연 어느 축에서도 변형 간 차이가 뚜렷하지 않습니다 ` +
      `(성공률 신뢰도 ${formatPercent(confidence)}). 더 관찰하거나 판단 기준을 정해 주세요.`,
    conclusive: false,
  };
}
