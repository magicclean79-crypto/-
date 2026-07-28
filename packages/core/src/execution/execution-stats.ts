import type { ExecutionStats, ExecutionStatus } from "@acos/shared";

/**
 * Execution Dashboard 집계. (TASK-0602, Sprint 6)
 *
 * 저장소가 (그룹 key, status) 단위로 집계한 행을 받아 성공률/실패율·토큰·
 * 비용·지연 통계로 병합하는 순수 로직 — DB 집계(groupBy)와 무관하게
 * 단위 테스트된다. 비용은 가격표에 있는 모델의 합계만 포함한다
 * (전부 미상이면 null — TASK-0601 원칙 유지).
 */
export interface ExecutionStatGroupRow {
  /** 그룹 값 (feature/provider/model 중 하나) — 전체 집계에서는 "" */
  key: string;
  status: ExecutionStatus;
  count: number;
  inputTokens: number;
  outputTokens: number;
  /** 비용 합계 (USD) — 해당 그룹에 가격 산정된 호출이 없으면 null */
  cost: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyStats(): ExecutionStats {
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

/** (key, status) 행들을 key별 통계로 병합한다 — key 정렬은 호출 수 내림차순 */
export function buildExecutionStats(
  rows: ExecutionStatGroupRow[],
): { key: string; stats: ExecutionStats }[] {
  const byKey = new Map<string, ExecutionStatGroupRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }

  const results: { key: string; stats: ExecutionStats }[] = [];
  for (const [key, groupRows] of byKey) {
    const stats = emptyStats();
    let latencyWeighted = 0;
    let latencyCount = 0;

    for (const row of groupRows) {
      stats.count += row.count;
      if (row.status === "SUCCESS") {
        stats.successCount += row.count;
      } else {
        stats.failedCount += row.count;
      }
      stats.inputTokens += row.inputTokens;
      stats.outputTokens += row.outputTokens;
      if (row.cost !== null) {
        stats.cost = round((stats.cost ?? 0) + row.cost, 6);
      }
      if (row.avgLatencyMs !== null) {
        latencyWeighted += row.avgLatencyMs * row.count;
        latencyCount += row.count;
      }
      if (row.maxLatencyMs !== null) {
        stats.maxLatencyMs = Math.max(stats.maxLatencyMs ?? 0, row.maxLatencyMs);
      }
    }

    if (stats.count > 0) {
      stats.successRate = round(stats.successCount / stats.count, 4);
      stats.failureRate = round(stats.failedCount / stats.count, 4);
    }
    if (latencyCount > 0) {
      stats.avgLatencyMs = round(latencyWeighted / latencyCount, 1);
    }
    results.push({ key, stats });
  }

  results.sort((a, b) => b.stats.count - a.stats.count);
  return results;
}

/** 전체 합계 — key 없이 병합한 단일 통계 */
export function buildExecutionTotals(
  rows: Omit<ExecutionStatGroupRow, "key">[],
): ExecutionStats {
  const grouped = buildExecutionStats(rows.map((row) => ({ ...row, key: "" })));
  return grouped[0]?.stats ?? emptyStats();
}
