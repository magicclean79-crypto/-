import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  buildRoutingTable,
  ExecutionTracker,
  LLM_FEATURE_PROVIDER_ENV,
  LlmGateway,
  LlmValidationError,
  resolveRoute,
  validateLlmRequest,
} from "@acos/core";
import type {
  ExecutionStore,
  LlmProvider,
  RoutingResolution,
} from "@acos/core";
import type {
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmGatewayInfoDto,
  LlmHealthDto,
  LlmRoutingDto,
} from "@acos/shared";
import { EXECUTION_STORE } from "../execution/execution.constants";
import { LlmBudgetService } from "./llm-budget.service";
import { LLM_PROVIDER, LLM_PROVIDER_MAP } from "./llm.constants";
import { routingModelOverrides, routingRules } from "./routing-config";

/**
 * 운영 출력 상한 (TASK-0901) — feature별 max tokens 기본값.
 * 실 Provider(OpenAI) 연결 시 어댑터 기본값(1024)은 상세페이지 생성에서
 * 잘림 위험이 있어, 호출 지점(LlmService) 한 곳에서 feature별로 채운다.
 * 호출자가 maxTokens를 명시하면 그 값을 우선한다. dev는 기본값 유지.
 */
const FEATURE_MAX_TOKENS: Record<string, { env: string; fallback: number }> = {
  "content-generation": { env: "LLM_CONTENT_MAX_TOKENS", fallback: 4096 },
  "product-analysis": { env: "LLM_ANALYSIS_MAX_TOKENS", fallback: 2048 },
  "vision-analysis": { env: "LLM_VISION_MAX_TOKENS", fallback: 2048 },
};

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
  /** 기본 Provider 게이트웨이 (LLM_PROVIDER) */
  private readonly gateway: LlmGateway;
  /** 라우팅 대상 Provider 게이트웨이 (TASK-1001) — 키가 설정된 것만 */
  private readonly gateways = new Map<string, LlmGateway>();
  private readonly tracker: ExecutionTracker | null;

  constructor(
    @Inject(LLM_PROVIDER) provider: LlmProvider,
    @Optional() @Inject(EXECUTION_STORE) executionStore?: ExecutionStore,
    @Optional() private readonly budget?: LlmBudgetService,
    @Optional()
    @Inject(LLM_PROVIDER_MAP)
    providerMap?: Map<string, LlmProvider>,
  ) {
    const createGateway = (target: LlmProvider): LlmGateway =>
      new LlmGateway(target, {
        maxAttempts: Math.max(1, Number(process.env.LLM_MAX_ATTEMPTS ?? 3)),
        onAttemptFailed: (attempt, error) =>
          this.logger.warn(`LLM attempt ${attempt} failed: ${error}`),
      });

    this.gateway = createGateway(provider);
    this.gateways.set(provider.name, this.gateway);
    // Cross-Provider Routing (TASK-1001): 사용 가능한 Provider 전부 준비
    for (const [name, target] of providerMap ?? []) {
      if (!this.gateways.has(name)) {
        this.gateways.set(name, createGateway(target));
      }
    }

    this.tracker = executionStore
      ? new ExecutionTracker(executionStore, {
          onRecordError: (error) =>
            this.logger.warn(`Execution 기록 실패: ${error}`),
        })
      : null;
  }

  /** 라우팅 해석 (TASK-1001) — 호출 시점마다 환경을 읽는다 (Dynamic) */
  private resolve(feature?: string): RoutingResolution {
    return resolveRoute({
      feature,
      defaultProvider: this.gateway.providerName,
      rules: routingRules(),
      modelOverrides: routingModelOverrides(),
      availableProviders: [...this.gateways.keys()],
    });
  }

  /** feature별 Provider 라우팅 현황 (GET /llm/routing) */
  routing(): LlmRoutingDto {
    return {
      defaultProvider: this.gateway.providerName,
      availableProviders: [...this.gateways.keys()],
      routes: buildRoutingTable({
        defaultProvider: this.gateway.providerName,
        rules: routingRules(),
        modelOverrides: routingModelOverrides(),
        availableProviders: [...this.gateways.keys()],
      }).map((route) => ({
        ...route,
        env: LLM_FEATURE_PROVIDER_ENV[route.feature] ?? "",
      })),
      checkedAt: new Date().toISOString(),
    };
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

    // 운영 출력 상한 (TASK-0901): 미지정 시 feature별 기본값을 채운다
    if (request.maxTokens === undefined && options.feature) {
      const entry = FEATURE_MAX_TOKENS[options.feature];
      if (entry) {
        const configured = Number(process.env[entry.env]);
        request = {
          ...request,
          maxTokens:
            Number.isInteger(configured) && configured > 0
              ? configured
              : entry.fallback,
        };
      }
    }

    // Cross-Provider Routing (TASK-1001): feature → Provider·모델 해석.
    // 호출자가 model을 명시하면 그 값이 최우선이다.
    const route = this.resolve(options.feature);
    const gateway = this.gateways.get(route.provider) ?? this.gateway;
    if (route.source === "fallback") {
      this.logger.warn(`라우팅 폴백 (${route.feature}): ${route.reason}`);
    }
    if (request.model === undefined && route.model) {
      request = { ...request, model: route.model };
    }

    // Cost Governance (TASK-0902): 예산 초과 시 호출 전 차단 (429) —
    // Execution 미기록 (호출 시도가 아님, 검증 오류와 동일 원칙)
    await this.budget?.assertWithinBudget();

    try {
      const run = (): ReturnType<LlmGateway["complete"]> =>
        gateway.complete(request);
      const result = this.tracker
        ? await this.tracker.track(
            options.feature ?? "dev",
            {
              provider: gateway.providerName,
              model: request.model ?? gateway.defaultModel,
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

  /**
   * Provider 상태 점검 (TASK-0603) — 실제 최소 완성 호출("ping", 소량 토큰)로
   * 키·네트워크·모델 접근을 확인한다. 이 호출도 Execution으로 기록된다
   * (feature "dev" — CTO 결정의 4종 유지). 실패해도 예외 대신 error 상태를 반환.
   */
  async health(): Promise<LlmHealthDto> {
    const startedAt = Date.now();
    try {
      const completion = await this.complete({
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 16,
      });
      return {
        provider: completion.provider,
        model: completion.model,
        status: "ok",
        latencyMs: Date.now() - startedAt,
        error: null,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider: this.gateway.providerName,
        model: this.gateway.defaultModel,
        status: "error",
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
