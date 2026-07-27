import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { LlmGateway, LlmValidationError } from "@acos/core";
import type { LlmProvider } from "@acos/core";
import type {
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmGatewayInfoDto,
} from "@acos/shared";
import { LLM_PROVIDER } from "./llm.constants";

/**
 * LLM Gateway 서비스 (TASK-0501).
 * 검증·재시도는 @acos/core의 LlmGateway가, 실제 호출은 선택된 Provider가
 * 담당한다. 다른 모듈(향후 콘텐츠 생성 등)은 이 서비스를 통해서만 LLM을 쓴다.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly gateway: LlmGateway;

  constructor(@Inject(LLM_PROVIDER) provider: LlmProvider) {
    this.gateway = new LlmGateway(provider, {
      maxAttempts: Math.max(1, Number(process.env.LLM_MAX_ATTEMPTS ?? 3)),
      onAttemptFailed: (attempt, error) =>
        this.logger.warn(`LLM attempt ${attempt} failed: ${error}`),
    });
  }

  async complete(request: LlmCompleteRequest): Promise<LlmCompletionDto> {
    try {
      const result = await this.gateway.complete(request);
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
