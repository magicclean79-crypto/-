import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { LLM_FEATURE_MODEL_ENV, LLM_PROVIDER_REGISTRY } from "@acos/core";
import type {
  LlmBudgetDto,
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmGatewayInfoDto,
  LlmHealthDto,
  LlmProvidersDto,
  LlmRoutingDto,
} from "@acos/shared";
import { HealthProtectionGuard } from "../auth/health-protection.guard";
import { LlmBudgetService } from "./llm-budget.service";
import { LlmService } from "./llm.service";

@Controller("llm")
export class LlmController {
  constructor(
    private readonly llmService: LlmService,
    private readonly budgetService: LlmBudgetService,
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
   * (TASK-0803, CTO 결정 0802-③ — 개발 환경은 비보호 유지)
   */
  @Get("health")
  @UseGuards(HealthProtectionGuard)
  async health(): Promise<LlmHealthDto> {
    return this.llmService.health();
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
