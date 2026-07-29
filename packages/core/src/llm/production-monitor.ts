/**
 * Production Monitoring. (TASK-1301, Sprint 13)
 *
 * 실 Provider 운영에서 "지금 정상인가"를 판정하는 순수 로직.
 * Execution 표본(최근 관측 창)을 받아 Provider별 성공률·지연 분포·비용을
 * 계산하고, 사람이 조치할 수 있는 경보로 요약한다.
 *
 * 설계 원칙:
 * - **표본이 적으면 판정하지 않는다** — 1회 실패로 "장애"라고 말하지 않는다
 *   (status="unknown"). 실험 분석의 최소 표본 원칙과 같은 태도다.
 * - 평균만 보면 꼬리 지연을 놓치므로 **p50/p95/p99**를 함께 낸다.
 * - 비용은 가격표가 없으면 조용히 0이 아니라 `unpricedCalls`로 드러낸다
 *   (Cost Verification과 같은 판단 — 예산 상한 무력화는 숨기지 않는다).
 */

export interface MonitorSample {
  provider: string;
  model: string;
  /** 성공 여부 — Execution status가 SUCCESS인지 */
  success: boolean;
  latencyMs: number | null;
  /** 기록된 비용 (USD) — null이면 미산정 */
  cost: number | null;
  createdAt: string;
}

export type MonitorStatus = "healthy" | "degraded" | "down" | "unknown";

export interface LatencyDistribution {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface ProviderMonitorRow {
  provider: string;
  calls: number;
  successCount: number;
  failedCount: number;
  /** 표본이 없으면 null */
  successRate: number | null;
  latency: LatencyDistribution | null;
  /** 비용 합계 (USD) — 산정된 호출이 하나도 없으면 null */
  cost: number | null;
  /** 호출당 평균 비용 (USD) — 산정된 호출 기준 */
  costPerCall: number | null;
  /** 가격표가 없어 비용이 빠진 호출 수 */
  unpricedCalls: number;
  models: string[];
  lastCallAt: string | null;
  status: MonitorStatus;
}

export interface MonitorAlert {
  level: "warning" | "critical";
  provider: string;
  message: string;
}

export interface ProductionMonitorResult {
  windowMinutes: number;
  /** 판정에 필요한 최소 호출 수 */
  minSamples: number;
  totals: {
    calls: number;
    successCount: number;
    failedCount: number;
    successRate: number | null;
    cost: number | null;
    unpricedCalls: number;
  };
  providers: ProviderMonitorRow[];
  alerts: MonitorAlert[];
  /** 전체 판정 — Provider 중 가장 나쁜 상태 */
  status: MonitorStatus;
}

export interface MonitorOptions {
  windowMinutes?: number;
  /** 상태를 판정하기 위한 최소 호출 수 (기본 5) */
  minSamples?: number;
  /** healthy 하한 성공률 (기본 0.95) */
  healthyRate?: number;
  /** degraded 하한 성공률 — 이보다 낮으면 down (기본 0.5) */
  degradedRate?: number;
  /** p95 지연 경고 기준 ms (기본 20000) */
  latencyWarnMs?: number;
}

/**
 * 기준 기본값 — **CTO 결정 1301-②로 공식 확정**된 값이다
 * (Healthy 95% / Degraded 50% / 최소 표본 5 / p95 20초).
 * 같은 결정에서 "향후 환경변수로 조정 가능하도록 설계"가 지시되어
 * `resolveMonitorOptions`로 덮어쓸 수 있게 두되, 미설정 시 이 값이 그대로 쓰인다.
 */
const DEFAULTS = {
  windowMinutes: 60,
  minSamples: 5,
  healthyRate: 0.95,
  degradedRate: 0.5,
  latencyWarnMs: 20_000,
};

/** 모니터링 기준 환경변수 (TASK-1302, CTO 결정 1301-②) */
export const MONITOR_OPTION_ENV = {
  minSamples: "LLM_MONITOR_MIN_SAMPLES",
  healthyRate: "LLM_MONITOR_HEALTHY_RATE",
  degradedRate: "LLM_MONITOR_DEGRADED_RATE",
  latencyWarnMs: "LLM_MONITOR_P95_WARN_MS",
} as const;

/** 확정 기본값 (표시·문서용) */
export const MONITOR_DEFAULTS: Readonly<typeof DEFAULTS> = DEFAULTS;

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  // 잘못 적은 값 때문에 판정 기준이 무너지는 것보다 기본값이 안전하다
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ratio(value: string | undefined, fallback: number): number {
  const parsed = positiveNumber(value, fallback);
  return parsed > 1 ? fallback : parsed;
}

/**
 * 환경에서 모니터링 기준을 읽는다 (CTO 결정 1301-②).
 * 값이 없거나 해석할 수 없으면 확정 기본값을 쓴다.
 * `degradedRate > healthyRate`처럼 순서가 뒤집힌 설정은 판정이 무의미해지므로
 * 둘 다 기본값으로 되돌린다 — 조용히 이상한 기준으로 판정하지 않는다.
 */
export function resolveMonitorOptions(
  env: Record<string, string | undefined>,
): MonitorOptions {
  const healthyRate = ratio(env[MONITOR_OPTION_ENV.healthyRate], DEFAULTS.healthyRate);
  const degradedRate = ratio(
    env[MONITOR_OPTION_ENV.degradedRate],
    DEFAULTS.degradedRate,
  );
  const ordered = degradedRate <= healthyRate;

  return {
    minSamples: Math.max(
      1,
      Math.round(
        positiveNumber(env[MONITOR_OPTION_ENV.minSamples], DEFAULTS.minSamples),
      ),
    ),
    healthyRate: ordered ? healthyRate : DEFAULTS.healthyRate,
    degradedRate: ordered ? degradedRate : DEFAULTS.degradedRate,
    latencyWarnMs: Math.round(
      positiveNumber(
        env[MONITOR_OPTION_ENV.latencyWarnMs],
        DEFAULTS.latencyWarnMs,
      ),
    ),
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 최근접 순위(nearest-rank) 백분위수.
 * 보간을 쓰지 않는 이유: 표본이 적을 때 실제로 관측되지 않은 값을
 * 지어내지 않기 위해서다 — p99는 "관측된 최악에 가까운 값"이어야 한다.
 */
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function statusOf(
  calls: number,
  successRate: number | null,
  options: Required<MonitorOptions>,
): MonitorStatus {
  // 표본이 부족하면 좋다고도 나쁘다고도 하지 않는다
  if (calls < options.minSamples || successRate === null) {
    return "unknown";
  }
  if (successRate >= options.healthyRate) {
    return "healthy";
  }
  if (successRate >= options.degradedRate) {
    return "degraded";
  }
  return "down";
}

const STATUS_SEVERITY: Record<MonitorStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  down: 3,
};

/** Provider별 운영 지표를 계산하고 경보를 만든다 (순수 함수) */
export function monitorProduction(
  samples: MonitorSample[],
  options: MonitorOptions = {},
): ProductionMonitorResult {
  const resolved: Required<MonitorOptions> = { ...DEFAULTS, ...options };

  const byProvider = new Map<string, MonitorSample[]>();
  for (const sample of samples) {
    byProvider.set(sample.provider, [
      ...(byProvider.get(sample.provider) ?? []),
      sample,
    ]);
  }

  const providers: ProviderMonitorRow[] = [];
  const alerts: MonitorAlert[] = [];

  for (const [provider, group] of byProvider) {
    const successCount = group.filter((sample) => sample.success).length;
    const failedCount = group.length - successCount;
    const successRate =
      group.length > 0 ? round(successCount / group.length, 4) : null;

    const latencies = group
      .map((sample) => sample.latencyMs)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    const latency: LatencyDistribution | null =
      latencies.length > 0
        ? {
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
            p99: percentile(latencies, 0.99),
            max: latencies[latencies.length - 1],
          }
        : null;

    const priced = group.filter((sample) => sample.cost !== null);
    const costSum = priced.reduce((sum, sample) => sum + (sample.cost ?? 0), 0);
    // 실패 호출은 대개 usage가 없다 — 미산정으로 셈하면 경보가 늘 울린다
    const unpricedCalls = group.filter(
      (sample) => sample.cost === null && sample.success,
    ).length;

    const status = statusOf(group.length, successRate, resolved);
    const lastCallAt = group
      .map((sample) => sample.createdAt)
      .sort()
      .at(-1) ?? null;

    providers.push({
      provider,
      calls: group.length,
      successCount,
      failedCount,
      successRate,
      latency,
      cost: priced.length > 0 ? round(costSum, 6) : null,
      costPerCall: priced.length > 0 ? round(costSum / priced.length, 6) : null,
      unpricedCalls,
      models: [...new Set(group.map((sample) => sample.model))].sort(),
      lastCallAt,
      status,
    });

    if (status === "down") {
      alerts.push({
        level: "critical",
        provider,
        message:
          `성공률 ${round((successRate ?? 0) * 100, 1)}% (${successCount}/${group.length}) — ` +
          "사실상 사용할 수 없는 상태입니다. 키·할당량·Provider 장애를 확인하세요.",
      });
    } else if (status === "degraded") {
      alerts.push({
        level: "warning",
        provider,
        message:
          `성공률 ${round((successRate ?? 0) * 100, 1)}% (${successCount}/${group.length}) — ` +
          `기준 ${round(resolved.healthyRate * 100, 1)}% 미만입니다. Failover 우선순위를 점검하세요.`,
      });
    }

    if (latency && latency.p95 > resolved.latencyWarnMs) {
      alerts.push({
        level: "warning",
        provider,
        message:
          `p95 지연 ${latency.p95}ms — 기준 ${resolved.latencyWarnMs}ms 초과입니다. ` +
          "타임아웃 설정과 모델 선택을 점검하세요.",
      });
    }

    if (unpricedCalls > 0) {
      alerts.push({
        level: "warning",
        provider,
        message:
          `비용 미산정 ${unpricedCalls}건 — 가격표에 없는 모델이 호출되고 있어 ` +
          "예산 상한이 적용되지 않습니다.",
      });
    }
  }

  providers.sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider));

  const totalSuccess = samples.filter((sample) => sample.success).length;
  const totalPriced = samples.filter((sample) => sample.cost !== null);
  const totalCost = totalPriced.reduce(
    (sum, sample) => sum + (sample.cost ?? 0),
    0,
  );

  const worst = providers.reduce<MonitorStatus>(
    (acc, row) =>
      STATUS_SEVERITY[row.status] > STATUS_SEVERITY[acc] ? row.status : acc,
    samples.length === 0 ? "unknown" : "healthy",
  );

  return {
    windowMinutes: resolved.windowMinutes,
    minSamples: resolved.minSamples,
    totals: {
      calls: samples.length,
      successCount: totalSuccess,
      failedCount: samples.length - totalSuccess,
      successRate:
        samples.length > 0 ? round(totalSuccess / samples.length, 4) : null,
      cost: totalPriced.length > 0 ? round(totalCost, 6) : null,
      unpricedCalls: providers.reduce((sum, row) => sum + row.unpricedCalls, 0),
    },
    providers,
    alerts,
    status: worst,
  };
}
