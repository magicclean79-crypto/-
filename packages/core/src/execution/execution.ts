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
  /**
   * 진단 호출 여부 (TASK-1302, CTO 결정 1301-③).
   *
   * Health Check·Live Check는 Provider를 실제로 호출하지만 **사용자
   * 트래픽이 아니다**. feature를 새로 만들지 않고(0601 승인의 4종 유지)
   * 메타데이터 한 칸으로 구분해, 운영 통계에서 분리하되 이력에는 남긴다.
   */
  diagnostic?: boolean;
  /**
   * 실제 호출 대상 (TASK-3501, CTO 정책 3501-④·⑤).
   *
   * **호출하는 그 자리에서** 남깁니다. 나중에 환경변수를 다시 읽어 추정하면,
   * 그 사이에 설정이 바뀐 경우 과거를 잘못 설명하게 됩니다 — 그리고 그
   * 잘못된 설명이 "전환 완료" 판정의 근거가 됩니다(TASK-3501에서 실제로
   * 그럴 뻔했습니다).
   *
   * 모르면 `null`입니다. **null은 "공식 주소였다"가 아니라 "모른다"** 입니다.
   */
  endpoint?: string | null;
  baseUrl?: string | null;
  calledAt?: Date | null;
  /**
   * 요청 추적 (TASK-3601, CTO 정책 3601-②).
   *
   * 한 번의 사용자 요청이 LLM·OCR을 여러 번 부릅니다. 그 호출들을 묶는 끈이
   * 없으면 "이 요청이 얼마를 썼는가"·"이 실패가 그 요청의 것인가"에 답할 수
   * 없고, 장애 때 로그와 기록을 손으로 맞춰 보게 됩니다.
   *
   * `requestId`는 우리 요청 1건, `traceId`는 그 요청이 속한 추적 전체입니다
   * (W3C `traceparent`가 있으면 그 값). 모르면 `null` — 지어내지 않습니다.
   */
  requestId?: string | null;
  traceId?: string | null;
  /**
   * 어느 프로젝트가 쓴 호출인가 (TASK-4201 정책 ④ · TASK-4301 정책 ②).
   *
   * **호출하는 그 자리에서** 남깁니다. 나중에 요청 기록을 뒤져 짐작하면
   * 그 순간부터 비용표는 관측이 아니라 추정이 되고, 그 추정으로 팀에 비용을
   * 청구하게 됩니다.
   *
   * 모르면 `null`이며 **null은 "공용"이 아니라 "모른다"** 입니다.
   */
  projectId?: string | null;
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
 * 모델별 가격표 (USD / 1M 토큰) — 코드 선언 중앙 정의 (CTO 결정, TASK-0601 승인 ④).
 * mock은 실제 API를 호출하지 않으므로 0. 없는 모델은 cost=null로 기록된다.
 *
 * OpenAI 단가는 TASK-0603(Provider Integration)에서 공식 공개 단가 기준으로
 * 등록 — 단가 변동 시 이 표 한 곳만 갱신하면 된다.
 */
export const DEFAULT_LLM_PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "mock-llm-1": { inputPerMillion: 0, outputPerMillion: 0 },
  // OpenAI (TASK-0603) — 공식 공개 단가 (USD / 1M tokens)
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // Anthropic (TASK-0903) — 공식 공개 단가 (USD / 1M tokens)
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
  // Google Gemini (TASK-0903) — 공식 공개 단가 (USD / 1M tokens)
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
};

/**
 * 모델 이름으로 가격을 찾는다 — 정확 일치 우선, 없으면 최장 접두사 일치.
 * (OpenAI 등은 응답 모델이 버전 스냅샷일 수 있다: "gpt-4o-2024-08-06" → "gpt-4o".
 *  "gpt-4o-mini-…"처럼 겹치는 경우 더 긴 key가 우선한다.)
 */
function findPricing(
  model: string,
  pricing: typeof DEFAULT_LLM_PRICING,
): { inputPerMillion: number; outputPerMillion: number } | null {
  if (pricing[model]) {
    return pricing[model];
  }
  let best: string | null = null;
  for (const key of Object.keys(pricing)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) {
      best = key;
    }
  }
  return best ? pricing[best] : null;
}

/** 토큰 사용량 → 예상 비용(USD). 가격표에 없는 모델이나 사용량 미상은 null */
export function estimateLlmCost(
  model: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
  pricing: typeof DEFAULT_LLM_PRICING = DEFAULT_LLM_PRICING,
): number | null {
  const price = findPricing(model, pricing);
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

/**
 * 가격표 공급자 (TASK-3101, CTO 정책 3101-①).
 *
 * 표 자체를 받거나 **매번 물어보는 함수**를 받는다. 함수를 허용하는 이유는
 * 단가가 절차(검토 → 승인 → 적용)를 거쳐 **운영 중에 바뀌기** 때문이다 —
 * 기동 시점에 한 번 읽어 두면 적용된 단가가 재기동 전까지 반영되지 않는다.
 */
export type LlmPricingSource =
  | typeof DEFAULT_LLM_PRICING
  | (() => typeof DEFAULT_LLM_PRICING | Promise<typeof DEFAULT_LLM_PRICING>);

export interface ExecutionTrackerOptions {
  /** 시각 함수 — 테스트에서 가짜로 대체할 수 있다 (기본 Date.now) */
  now?: () => number;
  /** 기록 실패 훅 (로깅용) — 기록 실패는 호출을 실패시키지 않는다 */
  onRecordError?: (error: string) => void;
  pricing?: LlmPricingSource;
  /**
   * 호출 대상 해석기 (TASK-3501, CTO 정책 3501-④).
   *
   * core는 환경변수를 읽지 않습니다 — 어댑터가 "지금 이 Provider를 부르면
   * 어디로 가는가"를 알려 줍니다. 주지 않으면 기록에 남지 않고, 그때 판정은
   * **모른다**로 셉니다(공식이었다고 세지 않습니다).
   */
  callTarget?: (provider: string) => {
    endpoint: string | null;
    baseUrl: string | null;
  } | null;
  /**
   * 요청 추적 해석기 (TASK-3601, CTO 정책 3601-②).
   *
   * core는 요청 컨텍스트를 모릅니다 — 어댑터가 "지금 처리 중인 요청은
   * 무엇인가"를 알려 줍니다. 주지 않으면 기록에 남지 않습니다(모르는 것을
   * 지어내지 않습니다).
   */
  trace?: () => { requestId: string | null; traceId: string | null } | null;
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
  private readonly pricing: LlmPricingSource;
  private readonly callTarget?: ExecutionTrackerOptions["callTarget"];
  private readonly trace?: ExecutionTrackerOptions["trace"];

  constructor(
    private readonly store: ExecutionStore,
    options: ExecutionTrackerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onRecordError = options.onRecordError;
    this.pricing = options.pricing ?? DEFAULT_LLM_PRICING;
    this.callTarget = options.callTarget;
    this.trace = options.trace;
  }

  /** 호출 대상 — 모르면 세 칸 모두 null (모르는 것을 지어내지 않는다) */
  private target(provider: string, calledAt: number, projectId: string | null) {
    const resolved = this.callTarget?.(provider) ?? null;
    const trace = this.trace?.() ?? null;
    return {
      endpoint: resolved?.endpoint ?? null,
      baseUrl: resolved?.baseUrl ?? null,
      calledAt: new Date(calledAt),
      // 한 요청이 부른 호출들을 묶는 끈 (정책 3601-②)
      requestId: trace?.requestId ?? null,
      traceId: trace?.traceId ?? null,
      // 프로젝트는 부르는 쪽이 알려 준다 (TASK-4301, 정책 4301-②)
      projectId,
    };
  }

  /**
   * 지금 유효한 가격표.
   *
   * 읽지 못하면 **기본 표로 계산한다** — 비용을 `null`로 남기면 예산 계산에서
   * 빠져 상한이 무력해지고, 그것이 조회 실패보다 위험하다.
   */
  private async table(): Promise<typeof DEFAULT_LLM_PRICING> {
    if (typeof this.pricing !== "function") {
      return this.pricing;
    }
    try {
      return await this.pricing();
    } catch {
      return DEFAULT_LLM_PRICING;
    }
  }

  async track<T extends TrackedLlmResult>(
    feature: string,
    fallback: { provider: string; model: string },
    run: () => Promise<T>,
    /** 진단 호출이면 true (TASK-1302, CTO 결정 1301-③) */
    options: { diagnostic?: boolean; projectId?: string | null } = {},
  ): Promise<T> {
    const startedAt = this.now();
    const diagnostic = options.diagnostic === true;
    try {
      const result = await run();
      await this.safeRecord({
        feature,
        provider: result.provider,
        model: result.model,
        status: "SUCCESS",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cost: estimateLlmCost(result.model, result.usage, await this.table()),
        latencyMs: this.now() - startedAt,
        error: null,
        diagnostic,
        // 성공한 호출이 **누구를 상대로** 이뤄졌는지 남긴다 (정책 3501-④)
        ...this.target(result.provider, startedAt, options.projectId ?? null),
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
        diagnostic,
        ...this.target(fallback.provider, startedAt, options.projectId ?? null),
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
