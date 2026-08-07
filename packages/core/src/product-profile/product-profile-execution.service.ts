import type {
  ProductProfileEngine,
  ProductProfileEngineInput,
  ProductProfileEngineResult,
} from "./product-profile-engine";

export type ProductProfileRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED";

export interface ProductProfileRun {
  id: string;
  status: ProductProfileRunStatus;
  imageFeatures: unknown;
  profile: unknown;
  error: string | null;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ProductProfileRunInput {
  imageIds: string[];
  projectId: string | null;
  /** 실행 시점 OCR 텍스트 스냅샷(감사용) */
  ocrText: string | null;
  /** STEP 5b 렌더링에 쓸 템플릿 키 — 감사·비교용으로 실행 기록에 남긴다 */
  templateKey?: string | null;
}

/**
 * Product Profile 실행 기록 저장소 (Port). — OcrRunStore(TASK-2901)와 같은
 * 원칙. apps/api에서는 Prisma 어댑터가 구현하고, 단위 테스트에서는 인메모리
 * 구현을 사용한다.
 */
export interface ProductProfileRunStore {
  /** 새 실행 레코드를 RUNNING 상태로 생성한다. */
  start(input: ProductProfileRunInput, provider: string): Promise<ProductProfileRun>;
  markSuccess(
    id: string,
    result: ProductProfileEngineResult,
    attempts: number,
  ): Promise<ProductProfileRun>;
  markFailed(id: string, error: string, attempts: number): Promise<ProductProfileRun>;
}

export interface ProductProfileExecutionOptions {
  /** Engine 호출 최대 시도 횟수 (기본 3) */
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
 * Product Profile Domain Service. (TASK-5601, Sprint 35)
 *
 * `OcrExecutionService`(TASK-2901)와 같은 구조 — Engine과 저장소(Port)를
 * 주입받아 상태 전이(PENDING → RUNNING → SUCCESS | FAILED)와 지수 백오프
 * 재시도를 프레임워크와 무관하게 처리한다.
 */
export class ProductProfileExecutionService {
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onAttemptFailed?: (attempt: number, error: string) => void;

  constructor(
    private readonly engine: ProductProfileEngine,
    private readonly store: ProductProfileRunStore,
    options: ProductProfileExecutionOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;
    this.onAttemptFailed = options.onAttemptFailed;
  }

  async execute(
    runInput: ProductProfileRunInput,
    engineInput: ProductProfileEngineInput,
  ): Promise<ProductProfileRun> {
    const run = await this.store.start(runInput, this.engine.name);

    let lastError = "";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await this.engine.run(engineInput);
        return this.store.markSuccess(run.id, result, attempt);
      } catch (error) {
        lastError = toMessage(error);
        this.onAttemptFailed?.(attempt, lastError);
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }
    return this.store.markFailed(
      run.id,
      lastError || "Product Profile 생성에 실패했습니다.",
      this.maxAttempts,
    );
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
