import { LlmValidationError } from "./llm-gateway";

/**
 * Provider Failover Engine. (TASK-1002, Sprint 10)
 *
 * 라우팅(TASK-1001)이 "어디로 보낼지"를 정한다면, Failover는 "그 호출이
 * 실패했을 때 어디로 넘길지"를 정한다. 두 계층은 분리되어 있다:
 * - 설정 해석 시 폴백(라우팅) = Provider를 쓸 수 없음(키 미설정) → 기본 Provider
 * - 실행 중 오류(Failover) = 호출이 실패/시간 초과 → 다음 우선순위 Provider
 *   (CTO 결정 1001-② 확정)
 *
 * **Failover 대상 (CTO 결정 1002-①)**: Timeout · Provider 5xx ·
 * Provider Rate Limit · 일시적 네트워크 오류.
 * **제외 대상**: Budget 초과 · Validation 오류 · 인증 오류(401/403) ·
 * 잘못된 API Key · 잘못된 요청. 이들은 Provider를 바꿔도 결과가 같거나
 * 요청 자체가 잘못된 것이므로 즉시 실패시킨다.
 */

/** Failover 대상이 아님을 표시하는 마커 — Budget/Validation 예외에 부여 */
export const NO_FAILOVER = Symbol.for("acos.llm.noFailover");

/** 예외에 "Failover 금지" 표시를 남긴다 (Budget 초과 등) */
export function markNoFailover<T extends object>(error: T): T {
  (error as Record<symbol, unknown>)[NO_FAILOVER] = true;
  return error;
}

/**
 * 오류 분류 (CTO 결정 1002-①). 앞 4종만 Failover 대상이다.
 * `unknown`은 분류하지 못한 오류 — 안전하게 제외한다(잘못된 요청을
 * 전 Provider에 반복하는 것보다 즉시 실패가 낫다).
 */
export type FailoverErrorKind =
  | "timeout"
  | "server_error"
  | "rate_limit"
  | "network"
  | "budget"
  | "validation"
  | "auth"
  | "invalid_request"
  | "unknown";

const FAILOVER_KINDS: ReadonlySet<FailoverErrorKind> = new Set([
  "timeout",
  "server_error",
  "rate_limit",
  "network",
]);

/** 일시적 네트워크 오류로 보는 Node/undici 오류 코드 */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Provider SDK 예외에서 HTTP 상태 코드를 찾는다 (SDK마다 위치가 다르다) */
function httpStatusOf(error: Record<string, unknown>): number | null {
  const direct = readNumber(error, "status") ?? readNumber(error, "statusCode");
  if (direct !== null) {
    return direct;
  }
  const response = error.response;
  if (response !== null && typeof response === "object") {
    return readNumber(response as Record<string, unknown>, "status");
  }
  return null;
}

/**
 * 오류를 분류한다. 상태 코드 → 오류 코드 → 메시지 순으로 판정하며,
 * 어느 것으로도 판정되지 않으면 `unknown`(= Failover 제외).
 */
export function classifyFailoverError(error: unknown): FailoverErrorKind {
  if (error instanceof LlmTimeoutError) {
    return "timeout";
  }
  if (error instanceof LlmValidationError) {
    return "validation";
  }
  if (error === null || typeof error !== "object") {
    return "unknown";
  }
  const record = error as Record<string, unknown>;
  if ((error as Record<symbol, unknown>)[NO_FAILOVER] === true) {
    // Budget 초과 등 명시적으로 금지된 오류
    return "budget";
  }

  const status = httpStatusOf(record);
  if (status !== null) {
    if (status === 401 || status === 403) {
      return "auth";
    }
    if (status === 429) {
      return "rate_limit";
    }
    if (status === 408) {
      return "timeout";
    }
    if (status >= 500) {
      return "server_error";
    }
    if (status >= 400) {
      return "invalid_request";
    }
  }

  const code = typeof record.code === "string" ? record.code : "";
  if (NETWORK_CODES.has(code.toUpperCase())) {
    return "network";
  }

  const message = typeof record.message === "string" ? record.message : "";
  if (/\b(401|403)\b|unauthorized|forbidden|invalid[ _-]?api[ _-]?key|incorrect api key|permission denied/i.test(message)) {
    return "auth";
  }
  if (/\b429\b|rate[ _-]?limit|too many requests|quota exceeded|overloaded/i.test(message)) {
    return "rate_limit";
  }
  if (/\b(408|timed? ?out)\b|etimedout|deadline exceeded/i.test(message)) {
    return "timeout";
  }
  if (/\b5\d{2}\b|internal server error|bad gateway|service unavailable|gateway timeout/i.test(message)) {
    return "server_error";
  }
  if (/econnreset|econnrefused|socket hang up|fetch failed|network (error|failure)|connection (reset|closed|refused)/i.test(message)) {
    return "network";
  }
  if (/\b400\b|invalid[ _-]?request|bad request|unsupported|not found|\b404\b/i.test(message)) {
    return "invalid_request";
  }
  return "unknown";
}

/**
 * 이 오류가 다른 Provider로 넘길 가치가 있는지 (CTO 결정 1002-①).
 * Timeout · 5xx · Rate Limit · 네트워크 오류만 true.
 */
export function isFailoverEligible(error: unknown): boolean {
  return FAILOVER_KINDS.has(classifyFailoverError(error));
}

/** Provider 호출이 제한 시간을 초과했을 때 */
export class LlmTimeoutError extends Error {
  constructor(
    readonly provider: string,
    readonly timeoutMs: number,
  ) {
    super(
      `Provider "${provider}" 호출이 ${timeoutMs}ms 안에 끝나지 않았습니다.`,
    );
    this.name = "LlmTimeoutError";
  }
}

/**
 * Timeout Policy — 제한 시간 안에 끝나지 않으면 LlmTimeoutError로 reject.
 * timeoutMs가 0 이하면 제한 없이 그대로 기다린다.
 * (호출 자체를 취소하지는 않는다 — Provider SDK에 취소 표준이 없으므로
 *  대기만 끊고 다음 Provider로 넘긴다.)
 */
export async function withTimeout<T>(
  run: () => Promise<T>,
  options: { timeoutMs: number; provider: string },
): Promise<T> {
  if (!(options.timeoutMs > 0)) {
    return run();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new LlmTimeoutError(options.provider, options.timeoutMs)),
          options.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export interface FailoverChainInput {
  /** 라우팅이 결정한 1순위 Provider */
  primary: string;
  /** 우선순위 목록 (LLM_FAILOVER_PRIORITY) — 비어 있으면 Failover 없음 */
  priority: string[];
  /** 인스턴스가 준비된 Provider */
  available: string[];
  /** 건강 상태 판정 (미지정이면 전부 건강) — 불건강 Provider는 뒤로 민다 */
  isHealthy?: (provider: string) => boolean;
}

/**
 * 시도 순서를 만든다: primary → 우선순위 목록(중복·미가용 제외).
 * Health Check 연동: 불건강한 Provider는 **제외하지 않고 뒤로 민다**
 * (전부 불건강해도 시도는 해야 하므로). primary가 불건강하면 건강한
 * 후보가 먼저 오지만, primary 자신은 체인에서 빠지지 않는다.
 */
export function buildFailoverChain(input: FailoverChainInput): string[] {
  const isHealthy = input.isHealthy ?? (() => true);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of [input.primary, ...input.priority]) {
    const name = candidate.trim().toLowerCase();
    if (!name || seen.has(name) || !input.available.includes(name)) {
      continue;
    }
    seen.add(name);
    ordered.push(name);
  }
  // 안정 정렬: 건강한 것 먼저, 같은 그룹 안에서는 원래 순서 유지
  return [
    ...ordered.filter((name) => isHealthy(name)),
    ...ordered.filter((name) => !isHealthy(name)),
  ];
}

export interface ProviderHealthState {
  provider: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  /** 불건강 상태가 풀리는 시각 (건강하면 null) */
  cooldownUntil: string | null;
}

export interface ProviderHealthOptions {
  /** 연속 실패 몇 회부터 불건강으로 볼지 (기본 3) */
  failureThreshold?: number;
  /** 불건강 유지 시간(ms) — 지나면 다시 시도 대상으로 승격 (기본 60초) */
  cooldownMs?: number;
}

/**
 * Health Check Integration — Provider별 건강 상태를 기억한다.
 *
 * 연속 실패가 임계에 도달하면 쿨다운 동안 불건강으로 보고 체인 뒤로 민다.
 * 성공(호출 또는 `/llm/health` 점검)하면 즉시 회복한다.
 * 인메모리 상태 — 다중 인스턴스에서는 인스턴스별로 관리된다.
 */
export class ProviderHealthTracker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly state = new Map<
    string,
    {
      consecutiveFailures: number;
      lastFailureAt: number | null;
      lastSuccessAt: number | null;
    }
  >();

  constructor(options: ProviderHealthOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 60_000);
  }

  private entry(provider: string) {
    const found = this.state.get(provider);
    if (found) {
      return found;
    }
    const created = {
      consecutiveFailures: 0,
      lastFailureAt: null as number | null,
      lastSuccessAt: null as number | null,
    };
    this.state.set(provider, created);
    return created;
  }

  recordSuccess(provider: string, now: number = Date.now()): void {
    const entry = this.entry(provider);
    entry.consecutiveFailures = 0;
    entry.lastSuccessAt = now;
  }

  recordFailure(provider: string, now: number = Date.now()): void {
    const entry = this.entry(provider);
    entry.consecutiveFailures += 1;
    entry.lastFailureAt = now;
  }

  isHealthy(provider: string, now: number = Date.now()): boolean {
    const entry = this.state.get(provider);
    if (!entry || entry.consecutiveFailures < this.failureThreshold) {
      return true;
    }
    // 쿨다운이 지나면 다시 시도 대상으로 (half-open)
    return (
      entry.lastFailureAt !== null && now - entry.lastFailureAt >= this.cooldownMs
    );
  }

  snapshot(
    providers: string[],
    now: number = Date.now(),
  ): ProviderHealthState[] {
    return providers.map((provider) => {
      const entry = this.state.get(provider);
      const healthy = this.isHealthy(provider, now);
      return {
        provider,
        healthy,
        consecutiveFailures: entry?.consecutiveFailures ?? 0,
        lastFailureAt: entry?.lastFailureAt
          ? new Date(entry.lastFailureAt).toISOString()
          : null,
        lastSuccessAt: entry?.lastSuccessAt
          ? new Date(entry.lastSuccessAt).toISOString()
          : null,
        cooldownUntil:
          !healthy && entry?.lastFailureAt
            ? new Date(entry.lastFailureAt + this.cooldownMs).toISOString()
            : null,
      };
    });
  }
}
