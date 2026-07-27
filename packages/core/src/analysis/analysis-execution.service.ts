import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisRun,
  AnalysisRunStore,
} from "./analysis-provider";

export interface AnalysisExecutionOptions {
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
 * Analysis Domain Service.
 *
 * Provider와 저장소(Port)를 주입받아
 * 상태 전이(PENDING → RUNNING → SUCCESS | FAILED)와
 * 지수 백오프 재시도를 프레임워크와 무관하게 처리한다.
 */
export class AnalysisExecutionService {
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onAttemptFailed?: (attempt: number, error: string) => void;

  constructor(
    private readonly provider: AnalysisProvider,
    private readonly store: AnalysisRunStore,
    options: AnalysisExecutionOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;
    this.onAttemptFailed = options.onAttemptFailed;
  }

  async execute(input: AnalysisInput): Promise<AnalysisRun> {
    const run = await this.store.start(input.product.id, this.provider.name);

    let lastError = "";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const recognition = await this.provider.analyze(input);
        return this.store.markSuccess(run.id, recognition, attempt);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.onAttemptFailed?.(attempt, lastError);
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }
    return this.store.markFailed(
      run.id,
      lastError || "분석 처리에 실패했습니다.",
      this.maxAttempts,
    );
  }
}
