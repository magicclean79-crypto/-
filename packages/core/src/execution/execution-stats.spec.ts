import {
  buildExecutionStats,
  buildExecutionTotals,
  type ExecutionStatGroupRow,
} from "./execution-stats";

const rows: ExecutionStatGroupRow[] = [
  {
    key: "content-generation",
    status: "SUCCESS",
    count: 3,
    inputTokens: 300,
    outputTokens: 150,
    cost: 0.03,
    avgLatencyMs: 10,
    maxLatencyMs: 20,
  },
  {
    key: "content-generation",
    status: "FAILED",
    count: 1,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    avgLatencyMs: 50,
    maxLatencyMs: 50,
  },
  {
    key: "product-analysis",
    status: "SUCCESS",
    count: 6,
    inputTokens: 600,
    outputTokens: 120,
    cost: null,
    avgLatencyMs: 5,
    maxLatencyMs: 8,
  },
];

describe("buildExecutionStats", () => {
  it("(key, status) 행을 key별 통계로 병합하고 호출 수 내림차순으로 정렬한다", () => {
    const result = buildExecutionStats(rows);

    expect(result.map((item) => item.key)).toEqual([
      "product-analysis",
      "content-generation",
    ]);

    const content = result[1].stats;
    expect(content).toEqual({
      count: 4,
      successCount: 3,
      failedCount: 1,
      successRate: 0.75,
      failureRate: 0.25,
      inputTokens: 300,
      outputTokens: 150,
      cost: 0.03,
      avgLatencyMs: 20, // (10*3 + 50*1) / 4
      maxLatencyMs: 50,
    });
  });

  it("가격 산정된 호출이 없는 그룹의 cost는 null", () => {
    const result = buildExecutionStats(rows);
    expect(result[0].stats.cost).toBeNull(); // product-analysis
  });
});

describe("buildExecutionTotals", () => {
  it("전체 합계를 단일 통계로 병합한다", () => {
    const totals = buildExecutionTotals(rows);

    expect(totals.count).toBe(10);
    expect(totals.successCount).toBe(9);
    expect(totals.failedCount).toBe(1);
    expect(totals.successRate).toBe(0.9);
    expect(totals.failureRate).toBe(0.1);
    expect(totals.inputTokens).toBe(900);
    expect(totals.cost).toBe(0.03); // 미상(null)은 합계에서 제외, 산정분만 포함
    expect(totals.avgLatencyMs).toBe(11); // (10*3+50*1+5*6)/10
    expect(totals.maxLatencyMs).toBe(50);
  });

  it("표본이 없으면 비율·지연은 null, 합계는 0", () => {
    const totals = buildExecutionTotals([]);
    expect(totals).toEqual({
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
    });
  });
});
