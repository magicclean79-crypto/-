/**
 * Failover 환경 설정. (TASK-1002, Sprint 10)
 *
 * - `LLM_FAILOVER_PRIORITY` = `openai,anthropic,gemini` — 실행 중 오류 시
 *   넘어갈 Provider 우선순위. **미설정이면 Failover 비활성**(기존 동작 유지)
 * - `LLM_TIMEOUT_MS` = Provider 1회 호출 제한 시간 (기본 120000, 0=무제한)
 * - `LLM_FAILOVER_HEALTH_THRESHOLD` = 연속 실패 임계 (기본 3)
 * - `LLM_FAILOVER_HEALTH_COOLDOWN_SEC` = 불건강 유지 시간 (기본 60초)
 *
 * 라우팅과 마찬가지로 **호출 시점마다 읽는다** (재기동 없이 반영).
 */

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** 우선순위 목록 (미설정이면 빈 배열 = Failover 비활성) */
export function failoverPriority(): string[] {
  return (process.env.LLM_FAILOVER_PRIORITY ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
}

/** Provider 1회 호출 제한 시간(ms) — 0이면 무제한 */
export function providerTimeoutMs(): number {
  return envInt(process.env.LLM_TIMEOUT_MS, 120_000);
}

/** Health Check 연동 설정 */
export function healthOptions(): {
  failureThreshold: number;
  cooldownMs: number;
} {
  return {
    failureThreshold: Math.max(
      1,
      envInt(process.env.LLM_FAILOVER_HEALTH_THRESHOLD, 3),
    ),
    cooldownMs: envInt(process.env.LLM_FAILOVER_HEALTH_COOLDOWN_SEC, 60) * 1000,
  };
}
