/**
 * 작업 재시도 계획. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 이 저장소에는 이미 재시도가 둘 있습니다:
 *
 * | | 무엇을 | 언제 |
 * | --- | --- | --- |
 * | `decideRetry` (1401) | 알림 전송 1건 | 초 단위, 4회 |
 * | `planResends` (4601) | 전달 못 한 알림 | 분·시간 단위, 3회 |
 *
 * 둘 다 **알림 전용**입니다. OCR·분석·콘텐츠 생성처럼 **돈이 나가는
 * 작업**에는 재시도가 없고, 실패하면 사용자가 버튼을 다시 누르는 것이
 * 전부였습니다.
 *
 * **기존 둘을 고치지 않습니다.** 여기는 작업(job)용이며, 같은 원칙을
 * 따르되 한 가지가 다릅니다:
 *
 * > **돈이 나가는 재시도는 공짜가 아닙니다.**
 *
 * 알림을 세 번 보내는 것과 LLM을 세 번 부르는 것은 비용이 다릅니다. 그래서
 * 이 계획은 **최대 횟수를 작게** 두고, **재시도할 때마다 그 사실을
 * 기록**하며, **막힌 것(예산·게이트)은 절대 재시도하지 않습니다** — 정책은
 * 기다린다고 바뀌지 않습니다.
 */

import { classifyFailure } from "./failure-taxonomy";
import type { FailureVerdict } from "./failure-taxonomy";

export interface JobRetryPolicy {
  /** 최초 시도를 포함한 최대 시도 횟수 */
  maxAttempts: number;
  /** 첫 재시도까지의 대기 (ms) — 이후 2배씩 */
  baseDelayMs: number;
  /** 대기 상한 (ms) */
  maxDelayMs: number;
}

/**
 * 기본값은 **3회**입니다(알림의 4회보다 적습니다).
 *
 * 돈이 나가는 호출을 네 번 하면 한 번의 사용자 행동이 네 배의 비용이 될 수
 * 있습니다. 세 번은 "잠깐의 흔들림"을 넘기기에 충분하고, 그것을 넘는
 * 실패는 대개 기다린다고 낫지 않습니다.
 */
export const DEFAULT_JOB_RETRY_POLICY: JobRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
};

export interface JobRetryDecision {
  retry: boolean;
  /** 다음 시도까지 기다릴 시간 (ms) — 재시도하지 않으면 0 */
  delayMs: number;
  /** 왜 이렇게 정했는가 — 기록과 화면에 그대로 실린다 */
  reason: string;
  verdict: FailureVerdict;
}

/**
 * 이 실패를 다시 시도할 것인가 (순수 함수).
 *
 * @param attempt 지금까지의 시도 횟수 (최초 시도가 1)
 */
export function planJobRetry(
  error: unknown,
  attempt: number,
  policy: JobRetryPolicy = DEFAULT_JOB_RETRY_POLICY,
): JobRetryDecision {
  const verdict = classifyFailure(error);

  if (!verdict.retriable) {
    return {
      retry: false,
      delayMs: 0,
      reason:
        verdict.kind === "blocked"
          ? "정책으로 막힌 작업입니다 — 기다린다고 열리지 않으므로 다시 시도하지 않습니다."
          : `다시 시도해도 같은 결과가 나오는 실패입니다(${verdict.kind}).`,
      verdict,
    };
  }

  if (attempt >= policy.maxAttempts) {
    return {
      retry: false,
      delayMs: 0,
      reason:
        `${policy.maxAttempts}번 시도했고 모두 실패했습니다. 더 매달리지 ` +
        "않습니다 — 돈이 나가는 호출을 계속 반복하면 실패 비용이 실패 " +
        "횟수만큼 커집니다.",
      verdict,
    };
  }

  const delayMs = jobRetryDelayMs(attempt, policy);
  return {
    retry: true,
    delayMs,
    reason: `${verdict.kind} 실패입니다 — ${Math.round(delayMs / 1000)}초 뒤 ${attempt + 1}번째로 다시 시도합니다.`,
    verdict,
  };
}

/** 지수 대기 — 상한을 넘지 않는다 */
export function jobRetryDelayMs(
  attempt: number,
  policy: JobRetryPolicy = DEFAULT_JOB_RETRY_POLICY,
): number {
  const raw = policy.baseDelayMs * 2 ** Math.max(attempt - 1, 0);
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * 환경변수에서 정책을 읽는다.
 *
 * **알 수 없는 값은 기본값으로 되돌리되 그 사실을 말합니다** — 조용히
 * 되돌리면 "바꿨다고 믿는데 안 바뀐" 상태가 됩니다(4601-③과 같은 규칙).
 */
export function resolveJobRetryPolicy(env: Record<string, string | undefined>): {
  policy: JobRetryPolicy;
  rejected: string[];
} {
  const rejected: string[] = [];
  const read = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      rejected.push(`${name}=${raw}`);
      return fallback;
    }
    return Math.round(value);
  };

  return {
    policy: {
      maxAttempts: read("JOB_RETRY_MAX_ATTEMPTS", DEFAULT_JOB_RETRY_POLICY.maxAttempts, 1, 5),
      baseDelayMs: read("JOB_RETRY_BASE_DELAY_MS", DEFAULT_JOB_RETRY_POLICY.baseDelayMs, 100, 60_000),
      maxDelayMs: read("JOB_RETRY_MAX_DELAY_MS", DEFAULT_JOB_RETRY_POLICY.maxDelayMs, 100, 300_000),
    },
    rejected,
  };
}
