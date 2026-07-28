import type {
  ExecutionStats,
  ExecutionTimelineBucketDto,
  ExecutionTimelineInterval,
} from "@acos/shared";

/** 0~1 비율(API 계약) → % 표기 (CTO 결정: %는 UI에서 표시) */
export function formatRate(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

export function formatCost(cost: number | null): string {
  return cost === null ? "미산정" : `$${cost.toFixed(4)}`;
}

export function formatLatency(latencyMs: number | null): string {
  return latencyMs === null ? "-" : `${latencyMs.toLocaleString()}ms`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

const INTERVAL_STEP_MS: Record<ExecutionTimelineInterval, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

export function emptyStats(): ExecutionStats {
  return {
    count: 0,
    successCount: 0,
    failedCount: 0,
    successRate: null,
    failureRate: null,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    avgLatencyMs: null,
    maxLatencyMs: null,
  };
}

/**
 * 빈 버킷 보간 (CTO 결정, TASK-0605 승인 ②: API는 빈 버킷을 만들지 않고
 * UI에서 보간한다) — 첫/마지막 버킷 사이의 비어 있는 시간대를 0 통계로 채운다.
 * 버킷은 UTC date_trunc 기준이라 ms 등차로 안전하게 전진할 수 있다.
 */
export function fillTimelineBuckets(
  buckets: ExecutionTimelineBucketDto[],
  interval: ExecutionTimelineInterval,
): ExecutionTimelineBucketDto[] {
  if (buckets.length <= 1) {
    return buckets;
  }
  const step = INTERVAL_STEP_MS[interval];
  const byStart = new Map(buckets.map((b) => [b.bucketStart, b]));
  const filled: ExecutionTimelineBucketDto[] = [];
  const start = Date.parse(buckets[0].bucketStart);
  const end = Date.parse(buckets[buckets.length - 1].bucketStart);
  for (let t = start; t <= end; t += step) {
    const iso = new Date(t).toISOString();
    filled.push(byStart.get(iso) ?? { bucketStart: iso, stats: emptyStats() });
  }
  return filled;
}

/** 버킷 라벨 (UTC 기준) — interval별 축 표기 */
export function bucketLabel(
  bucketStart: string,
  interval: ExecutionTimelineInterval,
): string {
  const date = new Date(bucketStart);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  if (interval === "hour") {
    return `${mm}.${dd} ${String(date.getUTCHours()).padStart(2, "0")}시`;
  }
  if (interval === "week") {
    return `${mm}.${dd}~`;
  }
  return `${mm}.${dd}`;
}
