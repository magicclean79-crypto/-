import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  buildFailoverChain,
  buildRoutingTable,
  classifyFailoverError,
  describeExperiment,
  ExecutionTracker,
  isFailoverEligible,
  LLM_FEATURE_PROVIDER_ENV,
  LlmGateway,
  LlmValidationError,
  pickVariant,
  ProviderHealthTracker,
  resolveCallTarget,
  resolveRoute,
  validateLlmRequest,
  withTimeout,
} from "@acos/core";
import {
  enabledProviders,
  providerEnabledKey,
  resolveLifecycle,
  variantKey,
} from "@acos/core";
import type {
  ExecutionStore,
  Experiment,
  ExperimentAssignment,
  ExperimentVariant,
  LlmProvider,
  RoutingResolution,
} from "@acos/core";
import type {
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmExperimentsDto,
  LlmFailoverDto,
  LlmGatewayInfoDto,
  LlmHealthDto,
  LlmRoutingDto,
} from "@acos/shared";
import { AdminSettingsService } from "../admin/admin-settings.service";
import { EXECUTION_STORE } from "../execution/execution.constants";
import { PricingService } from "../pricing/pricing.service";
import { RequestContextService } from "../common/request-context.service";
import { allExperiments, featureExperiment } from "./experiment-config";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import {
  failoverPriority,
  healthOptions,
  providerTimeoutMs,
} from "./failover-config";
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
  /** Provider 건강 상태 (TASK-1002 Health Check Integration) */
  private readonly healthTracker = new ProviderHealthTracker(healthOptions());
  /**
   * Failover 운영 계측 (인메모리 — 프로세스 시작 이후 누적).
   * **`GET /llm/health` 진단 호출은 여기서 제외한다** (CTO 결정 1002-④) —
   * 진단 횟수는 healthChecks로 따로 센다.
   */
  private readonly metrics = {
    attempts: 0,
    failovers: 0,
    exhausted: 0,
    skipped: 0,
    byProvider: new Map<string, { success: number; failed: number }>(),
    healthChecks: { ok: 0, failed: 0 },
    since: new Date().toISOString(),
  };
  /** 실험 배정 계측 (TASK-1003) — 설정 비율 대비 실제 분배 확인용 */
  private readonly assignments = new Map<string, number>();

  constructor(
    @Inject(LLM_PROVIDER) provider: LlmProvider,
    @Optional() @Inject(EXECUTION_STORE) executionStore?: ExecutionStore,
    @Optional() private readonly budget?: LlmBudgetService,
    @Optional()
    @Inject(LLM_PROVIDER_MAP)
    providerMap?: Map<string, LlmProvider>,
    @Optional() private readonly lifecycleService?: ExperimentLifecycleService,
    @Optional() private readonly settings?: AdminSettingsService,
    @Optional() pricingService?: PricingService,
    // 요청 추적 (TASK-3601, CTO 정책 3601-②) — 미주입이면 기록에 남지 않는다
    @Optional() requestContext?: RequestContextService,
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
          // 단가는 코드 상수가 아니라 **적용된 가격표**에서 온다
          // (TASK-3101, CTO 정책 3101-①). 미주입이면 기본 가격표를 쓴다 —
          // 비용을 null로 남기면 예산 계산에서 빠져 상한이 무력해진다.
          ...(pricingService
            ? {
                pricing: async () => (await pricingService.effective()).llm,
              }
            : {}),
          // 호출 대상을 **그 자리에서** 남긴다 (TASK-3501, CTO 정책 3501-④).
          // 나중에 환경변수를 다시 읽어 추정하면 그 사이에 설정이 바뀐 경우
          // 과거를 잘못 설명하게 되고, 그 설명이 전환 판정의 근거가 된다.
          callTarget: (provider) =>
            resolveCallTarget(
              provider,
              process.env as Record<string, string | undefined>,
            ),
          // 한 요청이 부른 호출들을 묶는 끈 (TASK-3601, CTO 정책 3601-②)
          ...(requestContext
            ? { trace: () => requestContext.current() }
            : {}),
        })
      : null;
  }

  /** 콘솔 오버라이드 조회 (TASK-1201) — 미주입이면 환경변수만 사용 */
  private setting = (key: string): string | null =>
    this.settings?.get(key) ?? null;

  /**
   * 실제로 쓸 수 있는 Provider (TASK-1201 Provider Enable/Disable).
   * 콘솔에서 끈 Provider는 라우팅·실험·Failover 후보에서 빠진다.
   * 전부 꺼지면 무시한다 — 호출이 전멸하는 것보다 낫다.
   */
  private availableProviders(): string[] {
    return enabledProviders({
      available: [...this.gateways.keys()],
      isDisabled: (provider) =>
        this.setting(providerEnabledKey(provider)) === "false",
    });
  }

  /** 라우팅 해석 (TASK-1001) — 호출 시점마다 환경을 읽는다 (Dynamic) */
  private resolve(feature?: string): RoutingResolution {
    return resolveRoute({
      feature,
      defaultProvider: this.gateway.providerName,
      rules: routingRules(),
      modelOverrides: routingModelOverrides(this.setting),
      availableProviders: this.availableProviders(),
    });
  }

  /** feature별 Provider 라우팅 현황 (GET /llm/routing) */
  routing(): LlmRoutingDto {
    const available = this.availableProviders();
    return {
      defaultProvider: this.gateway.providerName,
      availableProviders: available,
      routes: buildRoutingTable({
        defaultProvider: this.gateway.providerName,
        rules: routingRules(),
        modelOverrides: routingModelOverrides(this.setting),
        availableProviders: available,
      }).map((route) => ({
        ...route,
        env: LLM_FEATURE_PROVIDER_ENV[route.feature] ?? "",
      })),
      checkedAt: new Date().toISOString(),
    };
  }

  async complete(
    request: LlmCompleteRequest,
    options: {
      feature?: string;
      /** 특정 Provider로 강제 (Health Check 등) — 라우팅을 건너뛴다 */
      provider?: string;
      /**
       * 배정 주체 프로젝트 (TASK-1101 Sticky Assignment) —
       * 지정하면 같은 프로젝트가 항상 같은 실험 변형을 받는다.
       * 미지정이면 기존 무상태 추첨 (TASK-1003 동작).
       */
      projectId?: string;
      /** false면 Failover 없이 1순위만 시도 (기본 true) */
      failover?: boolean;
      /**
       * 진단 호출(`GET /llm/health`) — Failover 운영 계측(attempts/failovers/
       * exhausted/skipped/byProvider)에서 제외한다 (CTO 결정 1002-④).
       * Provider 건강 상태에는 그대로 반영된다.
       */
      diagnostic?: boolean;
    } = {},
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
    if (route.source === "fallback") {
      this.logger.warn(`라우팅 폴백 (${route.feature}): ${route.reason}`);
    }

    // Routing Experiment (TASK-1003) + Lifecycle·Sticky (TASK-1101):
    // 실험이 설정된 feature는 변형 선택이 라우팅 결과를 대신한다.
    // Provider 강제(진단)·전 변형 사용 불가면 실험을 적용하지 않고 기존
    // 라우팅으로 처리한다 (실험 설정이 호출을 실패시키지 않는다).
    const experiment = options.provider
      ? null
      : featureExperiment(options.feature, this.setting);
    const chosen = experiment
      ? await this.chooseVariant(experiment, options.projectId)
      : null;

    // 모델 우선순위: 호출자 명시 > 실험 변형 > 라우팅 규칙
    const resolvedModel = chosen?.model ?? route.model;
    if (request.model === undefined && resolvedModel) {
      request = { ...request, model: resolvedModel };
    }

    // Cost Governance (TASK-0902): 예산 초과 시 호출 전 차단 (429) —
    // Execution 미기록 (호출 시도가 아님, 검증 오류와 동일 원칙).
    // Budget 초과는 Failover 대상이 아니다 (CTO 지시).
    await this.budget?.assertWithinBudget();

    // Provider Failover (TASK-1002): 라우팅 결과를 1순위로 하는 시도 체인.
    // Provider 강제/Failover 비활성(Health Check 등)이면 단일 Provider만.
    const primary = options.provider ?? chosen?.provider ?? route.provider;
    const chain =
      options.failover === false
        ? [this.gateways.has(primary) ? primary : this.gateway.providerName]
        : buildFailoverChain({
            primary,
            priority: failoverPriority(),
            available: this.availableProviders(),
            isHealthy: (provider) => this.healthTracker.isHealthy(provider),
          });
    const timeoutMs = providerTimeoutMs();

    // 진단 호출은 운영 계측에서 분리한다 (CTO 결정 1002-④)
    const counted = options.diagnostic !== true;

    let lastError: unknown = null;
    for (const [index, providerName] of chain.entries()) {
      const gateway = this.gateways.get(providerName) ?? this.gateway;
      // 모델은 Provider마다 다르므로, 넘어간 Provider에는 그 Provider의
      // 기본 모델을 쓴다 (1순위에만 라우팅/호출자 모델 적용)
      const attemptRequest =
        index === 0 ? request : { ...request, model: undefined };
      if (counted) {
        this.metrics.attempts += 1;
      }

      try {
        const run = (): ReturnType<LlmGateway["complete"]> =>
          withTimeout(() => gateway.complete(attemptRequest), {
            timeoutMs,
            provider: providerName,
          });
        const result = this.tracker
          ? await this.tracker.track(
              options.feature ?? "dev",
              {
                provider: gateway.providerName,
                model: attemptRequest.model ?? gateway.defaultModel,
              },
              run,
              {
                // 진단 호출은 이력에 남기되 운영 통계에서 분리한다
                // (TASK-1302, CTO 결정 1301-③)
                diagnostic: !counted,
                // 어느 프로젝트가 쓴 호출인가 (TASK-4301, CTO 정책 4301-②).
                // 이 값은 이미 여기까지 와 있었는데 기록에는 안 남고 있었다 —
                // 그래서 비용표의 귀속률이 0에 가까웠다. 모르면 null이며
                // null은 "공용"이 아니라 "모른다"다.
                projectId: options.projectId ?? null,
              },
            )
          : await run();

        this.healthTracker.recordSuccess(providerName);
        if (counted) {
          this.countProvider(providerName, "success");
        } else {
          this.metrics.healthChecks.ok += 1;
        }
        return {
          provider: result.provider,
          model: result.model,
          text: result.text,
          usage: result.usage,
          createdAt: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error;
        if (error instanceof LlmValidationError) {
          // 요청 자체가 잘못됨 — Provider를 바꿔도 같다 (Failover 제외)
          if (counted) {
            this.metrics.skipped += 1;
          }
          throw new BadRequestException(error.message);
        }
        this.healthTracker.recordFailure(providerName);
        if (counted) {
          this.countProvider(providerName, "failed");
        } else {
          this.metrics.healthChecks.failed += 1;
        }

        if (!isFailoverEligible(error)) {
          // 인증·잘못된 요청 등 — Provider를 바꿔도 같다 (CTO 결정 1002-①)
          if (counted) {
            this.metrics.skipped += 1;
            this.logger.warn(
              `Provider "${providerName}" 실패 — Failover 대상이 아니어서 ` +
                `즉시 실패합니다 (${classifyFailoverError(error)}): ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
          throw error;
        }
        const next = chain[index + 1];
        if (!next) {
          if (counted) {
            this.metrics.exhausted += 1;
          }
          break;
        }
        if (counted) {
          this.metrics.failovers += 1;
        }
        this.logger.warn(
          `Provider "${providerName}" 실패 — "${next}"로 Failover합니다 ` +
            `(${classifyFailoverError(error)}): ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (lastError instanceof LlmValidationError) {
      throw new BadRequestException(lastError.message);
    }
    throw lastError ?? new Error("LLM 호출에 실패했습니다.");
  }

  /**
   * 실험 변형 선택 (TASK-1003 추첨 + TASK-1101 Lifecycle·Sticky).
   *
   * 1. **Lifecycle**: STOPPED면 적용하지 않고, PROMOTED면 승자 변형으로 고정
   * 2. **Sticky**: projectId가 있으면 프로젝트별 고정 배정(결정적 해시)
   * 3. 그 외(프로젝트를 모르는 호출)는 기존 무상태 추첨
   *
   * 상태 조회가 실패해도 호출을 막지 않는다 — 기본값(RUNNING)으로 진행한다.
   */
  private async chooseVariant(
    experiment: Experiment,
    projectId?: string,
  ): Promise<ExperimentVariant | null> {
    const available = this.availableProviders();

    if (this.lifecycleService) {
      let resolved;
      try {
        const state = await this.lifecycleService.state(experiment.feature);
        resolved = resolveLifecycle(state, experiment, available);
      } catch (error) {
        this.logger.warn(`실험 상태 조회 실패 (RUNNING으로 진행): ${error}`);
        resolved = { mode: "assign" as const };
      }
      if (resolved.mode === "skip") {
        this.logger.debug?.(
          `실험 미적용 (${experiment.feature}): ${resolved.reason}`,
        );
        return null;
      }
      if (resolved.mode === "promoted") {
        // 승자 확정 — 배정 없이 전 트래픽이 승자로 간다
        this.countAssignment(experiment.feature, variantKey(resolved.variant));
        return resolved.variant;
      }

      // Sticky Assignment — 같은 프로젝트는 항상 같은 변형
      if (projectId) {
        const sticky = await this.lifecycleService.assign(
          experiment,
          projectId,
          available,
        );
        if (!sticky) {
          return null;
        }
        this.countAssignment(experiment.feature, sticky.key);
        return sticky.variant;
      }
    }

    // 프로젝트를 모르는 호출 — 무상태 추첨 (TASK-1003 동작)
    const assignment: ExperimentAssignment | null = pickVariant(
      experiment.variants,
      { availableProviders: available },
    );
    if (!assignment) {
      return null;
    }
    this.countAssignment(experiment.feature, assignment.key);
    return assignment.variant;
  }

  private countAssignment(feature: string, key: string): void {
    const mapKey = `${feature}|${key}`;
    this.assignments.set(mapKey, (this.assignments.get(mapKey) ?? 0) + 1);
  }

  private countProvider(provider: string, outcome: "success" | "failed"): void {
    const entry = this.metrics.byProvider.get(provider) ?? {
      success: 0,
      failed: 0,
    };
    entry[outcome] += 1;
    this.metrics.byProvider.set(provider, entry);
  }

  /** Provider Failover 현황 (GET /llm/failover) */
  failover(): LlmFailoverDto {
    const priority = failoverPriority();
    return {
      enabled: priority.length > 0,
      priority,
      timeoutMs: providerTimeoutMs(),
      attemptsPerProvider: Math.max(
        1,
        Number(process.env.LLM_MAX_ATTEMPTS ?? 3),
      ),
      health: this.healthTracker.snapshot([...this.gateways.keys()]),
      metrics: {
        attempts: this.metrics.attempts,
        failovers: this.metrics.failovers,
        exhausted: this.metrics.exhausted,
        skipped: this.metrics.skipped,
        byProvider: [...this.metrics.byProvider.entries()].map(
          ([provider, counts]) => ({ provider, ...counts }),
        ),
        healthChecks: { ...this.metrics.healthChecks },
        since: this.metrics.since,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Routing Experiment 현황 (GET /llm/experiments, TASK-1003).
   * 설정된 변형·가중치와 **실제 배정 횟수**를 함께 돌려준다 —
   * 설정 비율대로 트래픽이 나뉘고 있는지 대시보드에서 바로 확인한다.
   */
  async experiments(): Promise<LlmExperimentsDto> {
    const available = this.availableProviders();
    const experiments = await Promise.all(
      allExperiments(this.setting).map(async (experiment) => {
        const view = describeExperiment(experiment, available);
        const counts = view.variants.map(
          (variant) =>
            this.assignments.get(`${experiment.feature}|${variant.key}`) ?? 0,
        );
        const total = counts.reduce((sum, count) => sum + count, 0);
        const lifecycle = (await this.lifecycleService?.lifecycle(
          experiment.feature,
        )) ?? {
          feature: experiment.feature,
          status: "RUNNING" as const,
          promotedVariant: null,
          actor: null,
          note: null,
          assignmentCount: 0,
          updatedAt: null,
          events: [],
        };
        return {
          ...view,
          // 상태에 따라 실제 적용 여부가 달라진다 (TASK-1101)
          active: view.active && lifecycle.status !== "STOPPED",
          assignments: total,
          lifecycle,
          variants: view.variants.map((variant, index) => ({
            ...variant,
            assignments: counts[index],
            actualShare: total > 0 ? counts[index] / total : null,
          })),
        };
      }),
    );
    return {
      availableProviders: available,
      experiments,
      checkedAt: new Date().toISOString(),
    };
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
   *
   * TASK-1002 (Health Check Integration): **Failover를 쓰지 않는다** —
   * 점검 대상 Provider의 실제 상태를 봐야 하기 때문이다. 결과는 Health
   * Tracker에 반영되어 이후 Failover 체인 순서에 영향을 준다.
   * `provider`를 지정하면 해당 Provider를 점검한다(불건강 상태 회복 확인용).
   *
   * CTO 결정 1002-④: 이 호출은 **Failover 운영 계측에서 분리**된다
   * (attempts/failovers/exhausted/skipped/byProvider 미집계 — 진단 횟수는
   * `metrics.healthChecks`로 따로 표시).
   */
  async health(provider?: string): Promise<LlmHealthDto> {
    const startedAt = Date.now();
    const target = provider?.trim().toLowerCase();
    const gateway =
      (target ? this.gateways.get(target) : undefined) ?? this.gateway;
    try {
      const completion = await this.complete(
        { messages: [{ role: "user", content: "ping" }], maxTokens: 16 },
        {
          provider: target ?? gateway.providerName,
          failover: false,
          diagnostic: true,
        },
      );
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
        provider: gateway.providerName,
        model: gateway.defaultModel,
        status: "error",
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
