/**
 * 단계별 성능 계측. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * "느리다"는 말은 고칠 수 없습니다. **어디가** 느린지가 있어야 고칩니다.
 * 지금 `executions.latencyMs`는 LLM 호출 1건의 시간이고, 한 작업이 여러
 * 호출과 파일 읽기와 DB 쓰기를 거치는 동안 **그 사이 시간은 아무도 안
 * 재고 있습니다.**
 *
 * ## 재지 못하는 것을 잰 척하지 않습니다
 *
 * 메모리가 그렇습니다. `process.memoryUsage()`는 **프로세스 전체** 값입니다.
 * 이 작업이 도는 동안 다른 요청 열 개가 같이 돌았다면, 그 증가분은 이
 * 작업의 것이 아닙니다. 그런데 "이 작업이 쓴 메모리 12MB"라고 적어 두면
 * 아무도 그 사실을 다시 확인하지 않습니다.
 *
 * 그래서 이름을 `processHeapDeltaBytes`로 두고, 판정은 **"이 작업의 값이
 * 아니다"** 라고 말합니다. 그래도 남기는 이유는, 한 작업이 도는 동안 힙이
 * 200MB 늘었다면 **그건 어느 작업의 것이든 봐야 할 신호**이기 때문입니다.
 */

/** 한 단계의 계측값 */
export interface StageMetric {
  stage: string;
  /** 걸린 시간 (ms) */
  durationMs: number;
  /** 이 단계가 쓴 토큰 — 모르면 null (0이 아닙니다) */
  tokens: { input: number | null; output: number | null } | null;
  /**
   * 단계 전후의 프로세스 힙 차이 (bytes).
   *
   * **이 단계가 쓴 메모리가 아닙니다** — 프로세스 전체 값이고, 같은 시간에
   * 다른 일이 돌았다면 그 몫이 섞여 있습니다.
   */
  processHeapDeltaBytes: number | null;
  ok: boolean;
}

export interface PerfReport {
  stages: StageMetric[];
  /** 전체 시간 (ms) — 단계 합이 아니라 처음부터 끝까지 */
  totalMs: number;
  /**
   * 단계 시간의 합. `totalMs`와 다르면 그 차이는 **우리가 안 잰 시간**입니다
   * — 대기·직렬화·프레임워크. 감추지 않고 그대로 돌려줍니다.
   */
  measuredMs: number;
  /** 안 잰 시간 (ms) */
  unmeasuredMs: number;
  /** 가장 오래 걸린 단계 — 없으면 null */
  slowest: StageMetric | null;
  /** 토큰 합계 — 하나라도 모르면 null (0으로 채우지 않습니다) */
  tokens: { input: number | null; output: number | null };
  detail: string;
}

/**
 * 계측 결과를 정리한다 (순수 함수).
 *
 * **토큰을 0으로 채우지 않습니다.** 모르는 값을 0으로 적으면 합계가 실제보다
 * 작아지고, 그 합계로 비용을 재면 청구서와 어긋납니다(3001의 규칙과 같음).
 */
export function summarizePerf(input: {
  stages: StageMetric[];
  totalMs: number;
}): PerfReport {
  const stages = input.stages;
  const measuredMs = stages.reduce((sum, row) => sum + row.durationMs, 0);
  const unmeasuredMs = Math.max(input.totalMs - measuredMs, 0);
  const slowest =
    stages.length === 0
      ? null
      : stages.reduce((best, row) => (row.durationMs > best.durationMs ? row : best), stages[0]);

  const tokens = sumTokens(stages);

  const parts: string[] = [
    `전체 ${formatMs(input.totalMs)} · 단계 ${stages.length}개.`,
  ];
  if (slowest !== null) {
    const share = input.totalMs > 0 ? Math.round((slowest.durationMs / input.totalMs) * 100) : 0;
    parts.push(
      `가장 오래 걸린 단계는 "${slowest.stage}"입니다 (${formatMs(slowest.durationMs)} · 전체의 ${share}%).`,
    );
  }
  if (unmeasuredMs > 0) {
    // 안 잰 시간을 감추면 "단계는 다 빠른데 전체는 느린" 상태를 설명할 수
    // 없습니다.
    parts.push(
      `단계 밖에서 ${formatMs(unmeasuredMs)}가 지났습니다 — 이 시간은 재지 않았습니다(대기·직렬화 등).`,
    );
  }
  if (tokens.input === null || tokens.output === null) {
    parts.push(
      "토큰을 알 수 없는 단계가 있어 합계를 내지 않았습니다 — 모르는 값을 0으로 채우면 합계가 실제보다 작아집니다.",
    );
  }

  return {
    stages,
    totalMs: input.totalMs,
    measuredMs,
    unmeasuredMs,
    slowest,
    tokens,
    detail: parts.join(" "),
  };
}

function sumTokens(stages: StageMetric[]): { input: number | null; output: number | null } {
  const withTokens = stages.filter((row) => row.tokens !== null);
  if (withTokens.length === 0) {
    return { input: null, output: null };
  }
  let input: number | null = 0;
  let output: number | null = 0;
  for (const row of withTokens) {
    if (row.tokens!.input === null) input = null;
    else if (input !== null) input += row.tokens!.input;
    if (row.tokens!.output === null) output = null;
    else if (output !== null) output += row.tokens!.output;
  }
  return { input, output };
}

/**
 * 느린 단계를 지목한다.
 *
 * **표본이 적으면 판정하지 않습니다**(4401-②와 같은 규칙). 한 번 느렸던
 * 것을 "느린 단계"로 적으면, 그날 네트워크가 흔들린 것이 영구 결함으로
 * 남습니다.
 */
export const PERF_MIN_SAMPLE = 5;

export type PerfVerdict = "ok" | "slow" | "insufficient";

export interface StageTrend {
  stage: string;
  samples: number;
  /** 중앙값 (ms) — 평균이 아닙니다: 한 번의 큰 값이 평균을 끌고 갑니다 */
  medianMs: number;
  /** 95퍼센타일 (ms) */
  p95Ms: number;
  verdict: PerfVerdict;
  detail: string;
}

export function analyzeStageTrend(input: {
  stage: string;
  durations: number[];
  /** 이 값을 넘는 중앙값을 느리다고 본다 (ms) */
  thresholdMs: number;
  minSample?: number;
}): StageTrend {
  const minSample = input.minSample ?? PERF_MIN_SAMPLE;
  const sorted = [...input.durations].sort((left, right) => left - right);
  const samples = sorted.length;

  if (samples < minSample) {
    return {
      stage: input.stage,
      samples,
      medianMs: samples === 0 ? 0 : percentile(sorted, 50),
      p95Ms: samples === 0 ? 0 : percentile(sorted, 95),
      verdict: "insufficient",
      detail:
        `표본이 ${samples}건으로 ${minSample}건에 못 미쳐 느린지 판정하지 ` +
        "않았습니다 — 빠르다는 뜻도 느리다는 뜻도 아닙니다.",
    };
  }

  const medianMs = percentile(sorted, 50);
  const p95Ms = percentile(sorted, 95);
  const slow = medianMs > input.thresholdMs;

  return {
    stage: input.stage,
    samples,
    medianMs,
    p95Ms,
    verdict: slow ? "slow" : "ok",
    detail: slow
      ? `중앙값 ${formatMs(medianMs)}로 기준(${formatMs(input.thresholdMs)})을 넘습니다. 95%는 ${formatMs(p95Ms)} 안에 끝납니다.`
      : `중앙값 ${formatMs(medianMs)} · 95%는 ${formatMs(p95Ms)} 안에 끝납니다.`,
  };
}

/** 선형 보간 없이 — 표본이 적을 때 보간은 없는 값을 만들어 냅니다 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.round(ms / 60_000)}분`;
}
