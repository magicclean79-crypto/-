import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  ExecutionTracker,
  LlmGateway,
  LlmValidationError,
  validateLlmRequest,
} from "@acos/core";
import type { ExecutionStore, LlmProvider } from "@acos/core";
import type {
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmGatewayInfoDto,
} from "@acos/shared";
import { EXECUTION_STORE } from "../execution/execution.constants";
import { LLM_PROVIDER } from "./llm.constants";

/**
 * LLM Gateway 서비스 (TASK-0501).
 * 검증·재시도는 @acos/core의 LlmGateway가, 실제 호출은 선택된 Provider가
 * 담당한다. 다른 모듈(콘텐츠 생성·분석·Vision 등)은 이 서비스를 통해서만
 * LLM을 쓴다.
 *
 * TASK-0601: 모든 호출은 ExecutionTracker로 감싸져 호출 1건당 Execution
 * 1건(feature/provider/model/token/cost/latency/status)이 기록된다.
 * 기록 실패는 호출을 실패시키지 않는다.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly gateway: LlmGateway;
  private readonly tracker: ExecutionTracker | null;

  constructor(
    @Inject(LLM_PROVIDER) provider: LlmProvider,
    @Optional() @Inject(EXECUTION_STORE) executionStore?: ExecutionStore,
  ) {
    this.gateway = new LlmGateway(provider, {
      maxAttempts: Math.max(1, Number(process.env.LLM_MAX_ATTEMPTS ?? 3)),
      onAttemptFailed: (attempt, error) =>
        this.logger.warn(`LLM attempt ${attempt} failed: ${error}`),
    });
    this.tracker = executionStore
      ? new ExecutionTracker(executionStore, {
          onRecordError: (error) =>
            this.logger.warn(`Execution 기록 실패: ${error}`),
        })
      : null;
  }

  async complete(
    request: LlmCompleteRequest,
    options: { feature?: string } = {},
  ): Promise<LlmCompletionDto> {
    // 검증 오류는 LLM 호출 시도가 아니므로 Execution을 기록하지 않는다
    const errors = validateLlmRequest(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    try {
      const run = (): ReturnType<LlmGateway["complete"]> =>
        this.gateway.complete(request);
      const result = this.tracker
        ? await this.tracker.track(
            options.feature ?? "dev",
            {
              provider: this.gateway.providerName,
              model: request.model ?? this.gateway.defaultModel,
            },
            run,
          )
        : await run();
      return {
        provider: result.provider,
        model: result.model,
        text: result.text,
        usage: result.usage,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof LlmValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  info(): LlmGatewayInfoDto {
    return {
      provider: this.gateway.providerName,
      defaultModel: this.gateway.defaultModel,
    };
  }
}
