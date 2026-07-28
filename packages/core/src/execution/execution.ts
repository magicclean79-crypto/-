import type { ExecutionStatus } from "@acos/shared";

/**
 * Execution Domain. (TASK-0601, Sprint 6)
 *
 * 모든 LLM 호출(Content Generation · Analysis · Vision · 개발용 API)은
 * 호출 1건당 Execution 1건을 기록한다 — Provider/Model/Token/Cost/Latency/
 * Status의 관측 지점. 기록 실패는 호출을 실패시키지 않는다(가용성 우선).
 * 자세한 구조: docs/architecture/execution.md
 */

/** LLM 호출 기능 식별자 — Execution.feature에 기록된다 */
export const EXECUTION_FEATURES = [
  "content-generation",
  "product-analysis",
  "vision-analysis",
  "dev",
] as const;

export type ExecutionFeature = (typeof EXECUTION_FEATURES)[number];

export interface NewExecution {
  feature: string;
  provider: string;
  model: string;
  status: ExecutionStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  /** 예상 비용 (USD) — 가격표에 없는 모델은 null */
  cost: number | null;
  latencyMs: number;
  error: string | null;
}

/** Execution Domain 모델 — 저장소와 무관한 순수 표현 */
export interface ExecutionRecord extends NewExecution {
  id: string;
  createdAt: Date;
}

/** Execution 기록 저장소 (Port) — Prisma 어댑터는 apps/api에 둔다 */
export interface ExecutionStore {
  record(entry: NewExecution): Promise<ExecutionRecord>;
}

/**
 * 모델별 가격표 (USD / 1M 토큰) — 코드 선언.
 * mock은 실제 API를 호출하지 않으므로 0. 실모델 가격은 공식 단가 스펙이
 * 확정되면 여기에 추가한다 (없는 모델은 cost=null로 기록됨 — CTO_REQUEST 참고).
 */
export const DEFAULT_LLM_PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "mock-llm-1": { inputPerMillion: 0, outputPerMillion: 0 },
};

/** 토큰 사용량 → 예상 비용(USD). 가격표에 없는 모델이나 사용량 미상은 null */
export function estimateLlmCost(
  model: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
  pricing: typeof DEFAULT_LLM_PRICING = DEFAULT_LLM_PRICING,
): number | null {
  const price = pricing[model];
  if (!price) {
    return null;
  }
  if (usage.inputTokens === null || usage.outputTokens === null) {
    return null;
  }
  const cost =
    (usage.inputTokens * price.inputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000;
  return Number(cost.toFixed(6));
}

export interface ExecutionTrackerOptions {
  /** 시각 함수 — 테스트에서 가짜로 대체할 수 있다 (기본 Date.now) */
  now?: () => number;
  /** 기록 실패 훅 (로깅용) — 기록 실패는 호출을 실패시키지 않는다 */
  onRecordError?: (error: string) => void;
  pricing?: typeof DEFAULT_LLM_PRICING;
}

export interface TrackedLlmResult {
  provider: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/**
 * LLM 호출을 감싸 Execution을 기록하는 도메인 서비스.
 * 성공 시 결과의 provider/model/usage로, 실패 시 폴백 값으로 기록하고
 * 원래 오류를 그대로 다시 던진다.
 */
export class ExecutionTracker {
  private readonly now: () => number;
  private readonly onRecordError?: (error: string) => void;
  private readonly pricing: typeof DEFAULT_LLM_PRICING;

  constructor(
    private readonly store: ExecutionStore,
    options: ExecutionTrackerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onRecordError = options.onRecordError;
    this.pricing = options.pricing ?? DEFAULT_LLM_PRICING;
  }

  async track<T extends TrackedLlmResult>(
    feature: string,
    fallback: { provider: string; model: string },
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await run();
      await this.safeRecord({
        feature,
        provider: result.provider,
        model: result.model,
        status: "SUCCESS",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cost: estimateLlmCost(result.model, result.usage, this.pricing),
        latencyMs: this.now() - startedAt,
        error: null,
      });
      return result;
    } catch (error) {
      await this.safeRecord({
        feature,
        provider: fallback.provider,
        model: fallback.model,
        status: "FAILED",
        inputTokens: null,
        outputTokens: null,
        cost: null,
        latencyMs: this.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async safeRecord(entry: NewExecution): Promise<void> {
    try {
      await this.store.record(entry);
    } catch (error) {
      this.onRecordError?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
