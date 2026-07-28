import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  EXPERIMENT_ACTIONS,
  LLM_FEATURE_EXPERIMENT_ENV,
  LLM_FEATURE_MODEL_ENV,
  LLM_PROVIDER_REGISTRY,
} from "@acos/core";
import type {
  CostVerificationDto,
  ExperimentActionDto,
  ExperimentAnalyticsDto,
  ExperimentAssignmentsDto,
  ExperimentLifecycleDto,
  ExperimentTransitionRequest,
  LlmBudgetDto,
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmExperimentsDto,
  LlmFailoverDto,
  LlmGatewayInfoDto,
  LlmHealthDto,
  LlmProvidersDto,
  LlmRoutingDto,
  ProductionMonitorDto,
  ProviderValidationReportDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { HealthProtectionGuard } from "../auth/health-protection.guard";
import { featureExperiment } from "./experiment-config";
import { ExperimentAnalyticsService } from "./experiment-analytics.service";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import { LlmBudgetService } from "./llm-budget.service";
import { LlmService } from "./llm.service";
import { ProviderProductionService } from "./provider-production.service";

@Controller("llm")
export class LlmController {
  constructor(
    private readonly llmService: LlmService,
    private readonly budgetService: LlmBudgetService,
    private readonly lifecycle: ExperimentLifecycleService,
    private readonly analyticsService: ExperimentAnalyticsService,
    private readonly production: ProviderProductionService,
  ) {}

  /** 선택된 Provider 확인 (기본 mock) */
  @Get()
  info(): LlmGatewayInfoDto {
    return this.llmService.info();
  }

  /**
   * Provider Registry + Model Routing 현황 (TASK-0902).
   * 키는 설정 여부만 노출한다 (값 비노출).
   */
  @Get("providers")
  providers(): LlmProvidersDto {
    const selected = this.llmService.info();
    return {
      selected,
      routing: Object.fromEntries(
        Object.entries(LLM_FEATURE_MODEL_ENV).map(([feature, env]) => [
          feature,
          process.env[env] ?? null,
        ]),
      ),
      providers: LLM_PROVIDER_REGISTRY.map((info) => ({
        name: info.name,
        title: info.title,
        connection: info.connection,
        keyConfigured: info.keyEnv ? Boolean(process.env[info.keyEnv]) : true,
        selected: info.name === selected.provider,
        defaultModel: info.defaultModel,
        models: info.models,
        note: info.note,
      })),
    };
  }

  /**
   * API Key Validation (TASK-1301) — Provider별 키 형식·필수 여부·어댑터
   * 생성 여부를 확인한다. 키 값은 노출하지 않는다 (앞부분 힌트·길이만).
   *
   * `?live=1`이면 Provider마다 최소 완성 호출을 1회 실행한다 — **실제 과금이
   * 발생**하므로 기본은 형식 검사만 하고, 실행 여부를 응답에 표시한다.
   *
   * 조회만으로도 운영 설정 지형이 드러나므로 **ADMIN 전용**
   * (CTO 결정 1201-⑤와 같은 판단).
   */
  @Get("providers/validate")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async validateProviders(
    @Query("live") live?: string,
  ): Promise<ProviderValidationReportDto> {
    return this.production.validateProviders({
      live: live === "1" || live === "true",
    });
  }

  /**
   * Cost Verification (TASK-1301) — 기록된 비용을 가격표로 재계산해 검증한다.
   * 가격표에 없는 모델은 비용이 null로 남아 **예산 상한이 무력화**되므로
   * 가장 먼저 드러내야 하는 문제다. ADMIN 전용.
   */
  @Get("cost-verification")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async costVerification(
    @Query("hours") hours?: string,
  ): Promise<CostVerificationDto> {
    return this.production.verifyCost({ hours: Number(hours) || undefined });
  }

  /**
   * Production Monitoring (TASK-1301) — 관측 창 안의 Provider별 성공률·
   * 지연 분포(p50/p95/p99)·비용과 경보. 표본이 적으면 판정하지 않는다
   * (unknown — 1회 실패로 장애라고 말하지 않는다). ADMIN 전용.
   */
  @Get("monitoring")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async monitoring(
    @Query("minutes") minutes?: string,
  ): Promise<ProductionMonitorDto> {
    return this.production.monitor({ minutes: Number(minutes) || undefined });
  }

  /** 비용 예산 현황 (TASK-0902) — UTC 일/월 지출·예산·경고 상태 */
  @Get("budget")
  async budget(): Promise<LlmBudgetDto> {
    return this.budgetService.status();
  }

  /**
   * Cross-Provider Routing 현황 (TASK-1001) — feature별 Provider·모델과
   * 결정 근거(feature/default/fallback). 호출 시점 해석이므로 환경 변경이
   * 재기동 없이 즉시 반영된다.
   */
  @Get("routing")
  routing(): LlmRoutingDto {
    return this.llmService.routing();
  }

  /**
   * Provider 상태 점검 (TASK-0603) — 최소 완성 호출로 키/네트워크/모델 확인.
   * GET이지만 실 호출이 발생하므로 운영/스테이징에서는 EDITOR 이상 인증
   * (TASK-0803, CTO 결정 0802-③ — 개발 환경은 비보호 유지).
   * `?provider=` 로 특정 Provider 점검 (TASK-1002 — Failover 미사용,
   * 결과가 Health Tracker에 반영되어 체인 순서에 영향).
   */
  @Get("health")
  @UseGuards(HealthProtectionGuard)
  async health(@Query("provider") provider?: string): Promise<LlmHealthDto> {
    return this.llmService.health(provider);
  }

  /**
   * Provider Failover 현황 (TASK-1002) — 우선순위·타임아웃·Provider 건강
   * 상태·Failover 계측. Budget/Validation 오류는 Failover 대상이 아니다.
   */
  @Get("failover")
  failover(): LlmFailoverDto {
    return this.llmService.failover();
  }

  /**
   * Routing Experiment 현황 (TASK-1003) — feature별 실험(종류·변형·가중치)과
   * 실제 배정 분포. Percentage / A·B / Canary / Weighted를 모두 표현한다.
   */
  @Get("experiments")
  async experiments(): Promise<LlmExperimentsDto> {
    return this.llmService.experiments();
  }

  /**
   * Assignment Dashboard (TASK-1101) — Project별 Sticky 배정 목록과
   * 변형별 분포. `?feature=`로 좁힐 수 있다.
   */
  @Get("experiments/assignments")
  async assignments(
    @Query("feature") feature?: string,
    @Query("limit") limit?: string,
  ): Promise<ExperimentAssignmentsDto> {
    const [assignments, distribution, reassignments] = await Promise.all([
      this.lifecycle.assignments({ feature, limit: Number(limit) || undefined }),
      feature
        ? this.lifecycle.distribution(feature)
        : Promise.resolve<{ variantKey: string; projects: number }[]>([]),
      this.lifecycle.reassignments({ feature }),
    ]);
    return { assignments, distribution, reassignments };
  }

  /**
   * 실험 시작·중단 (TASK-1101) — **EDITOR 이상** (CTO 결정 1101-④).
   * 트래픽 분배를 켜고 끄는 조작이다.
   */
  @Post("experiments/:feature/start")
  @HttpCode(200)
  async start(
    @Param("feature") feature: string,
    @Body() body: ExperimentTransitionRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<ExperimentLifecycleDto> {
    return this.transition(feature, "START", body, request);
  }

  @Post("experiments/:feature/stop")
  @HttpCode(200)
  async stop(
    @Param("feature") feature: string,
    @Body() body: ExperimentTransitionRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<ExperimentLifecycleDto> {
    return this.transition(feature, "STOP", body, request);
  }

  /**
   * 승자 승격·되돌리기 (TASK-1101) — **ADMIN 전용** (CTO 결정 1101-④).
   * 트래픽 100%의 목적지를 바꾸는 조작이라 시작·중단보다 높은 권한을 둔다.
   * PROMOTE는 `variantKey`(승자)를 함께 보낸다.
   */
  @Post("experiments/:feature/promote")
  @HttpCode(200)
  @RequireRole("ADMIN")
  async promote(
    @Param("feature") feature: string,
    @Body() body: ExperimentTransitionRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<ExperimentLifecycleDto> {
    return this.transition(feature, "PROMOTE", body, request);
  }

  @Post("experiments/:feature/rollback")
  @HttpCode(200)
  @RequireRole("ADMIN")
  async rollback(
    @Param("feature") feature: string,
    @Body() body: ExperimentTransitionRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<ExperimentLifecycleDto> {
    return this.transition(feature, "ROLLBACK", body, request);
  }

  private async transition(
    feature: string,
    action: string,
    body: ExperimentTransitionRequest,
    request: AuthenticatedRequest,
  ): Promise<ExperimentLifecycleDto> {
    const normalized = action.toUpperCase();
    if (!(EXPERIMENT_ACTIONS as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `지원하지 않는 동작입니다: ${action} (${EXPERIMENT_ACTIONS.join(" / ")})`,
      );
    }
    if (!LLM_FEATURE_EXPERIMENT_ENV[feature]) {
      throw new BadRequestException(
        `실험 대상 feature가 아닙니다: ${feature} (${Object.keys(LLM_FEATURE_EXPERIMENT_ENV).join(" / ")})`,
      );
    }
    return this.lifecycle.transition({
      feature,
      action: normalized as ExperimentActionDto,
      variantKey: body?.variantKey ?? null,
      note: body?.note ?? null,
      actor: request.user?.email ?? null,
      experiment: featureExperiment(feature),
    });
  }

  /**
   * Experiment Analytics (TASK-1102) — 변형별 성과 요약과 승자 추천.
   * 성공률·지연·비용 비교와 신뢰도(Confidence)를 함께 제공한다.
   */
  @Get("experiments/:feature/analytics")
  async analytics(
    @Param("feature") feature: string,
  ): Promise<ExperimentAnalyticsDto> {
    if (!LLM_FEATURE_EXPERIMENT_ENV[feature]) {
      throw new BadRequestException(
        `실험 대상 feature가 아닙니다: ${feature} (${Object.keys(LLM_FEATURE_EXPERIMENT_ENV).join(" / ")})`,
      );
    }
    return this.analyticsService.analyze(feature);
  }

  /** 텍스트 완성 — 게이트웨이를 통해 선택된 Provider 호출 */
  @Post("complete")
  @HttpCode(200)
  async complete(
    @Body() body: LlmCompleteRequest,
  ): Promise<LlmCompletionDto> {
    return this.llmService.complete(body ?? ({} as LlmCompleteRequest));
  }
}
