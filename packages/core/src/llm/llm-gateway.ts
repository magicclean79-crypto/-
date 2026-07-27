import { LLM_MESSAGE_ROLES } from "@acos/shared";
import type { LlmProvider, LlmRequest, LlmResult } from "./llm-provider";

/** 입력 검증 실패 — API 계층에서 400으로 매핑한다 */
export class LlmValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "LlmValidationError";
  }
}

export interface LlmGatewayOptions {
  /** Provider 호출 최대 시도 횟수 (기본 3) */
  maxAttempts?: number;
  /** 재시도 기본 지연(ms). 시도마다 2배로 늘어난다. (기본 500) */
  retryBaseDelayMs?: number;
  /** 대기 함수 — 테스트에서 가짜로 대체할 수 있다. */
  sleep?: (ms: number) => Promise<void>;
  /** 시도 실패 훅 (로깅용) */
  onAttemptFailed?: (attempt: number, error: string) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * LLM Gateway — Provider 위에서 검증·재시도를 담당하는 도메인 서비스.
 * (TASK-0501, OcrExecutionService와 같은 결 — 프레임워크 무관)
 *
 * Provider는 생성 시 주입되며(LLM_PROVIDER 환경변수로 선택, 기본 mock),
 * 게이트웨이 사용자는 어떤 모델이 뒤에 있는지 몰라도 된다.
 */
export class LlmGateway {
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onAttemptFailed?: (attempt: number, error: string) => void;

  constructor(
    private readonly provider: LlmProvider,
    options: LlmGatewayOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;
    this.onAttemptFailed = options.onAttemptFailed;
  }

  get providerName(): string {
    return this.provider.name;
  }

  get defaultModel(): string {
    return this.provider.defaultModel;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const errors = validateLlmRequest(request);
    if (errors.length > 0) {
      throw new LlmValidationError(errors);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.provider.complete(request);
      } catch (error) {
        lastError = error;
        this.onAttemptFailed?.(
          attempt,
          error instanceof Error ? error.message : String(error),
        );
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
}

/** 요청 검증 — 메시지 1개 이상, 유효한 role, 공백 content 불가 */
export function validateLlmRequest(request: Partial<LlmRequest>): string[] {
  const errors: string[] = [];
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    errors.push("messages는 1개 이상이어야 합니다.");
    return errors;
  }
  request.messages.forEach((message, index) => {
    if (!(LLM_MESSAGE_ROLES as readonly string[]).includes(message?.role)) {
      errors.push(
        `messages[${index}].role은 다음 중 하나여야 합니다: ${LLM_MESSAGE_ROLES.join(", ")}`,
      );
    }
    if (
      typeof message?.content !== "string" ||
      message.content.trim().length === 0
    ) {
      errors.push(`messages[${index}].content은(는) 비어 있을 수 없습니다.`);
    }
  });
  if (
    request.maxTokens !== undefined &&
    (!Number.isInteger(request.maxTokens) || request.maxTokens < 1)
  ) {
    errors.push("maxTokens는 1 이상의 정수여야 합니다.");
  }
  return errors;
}
