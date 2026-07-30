import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ExecutionModule } from "../execution/execution.module";
import { PricingModule } from "../pricing/pricing.module";
import { ExperimentAnalyticsService } from "./experiment-analytics.service";
import { ExperimentLifecycleService } from "./experiment-lifecycle.service";
import { LlmBudgetService } from "./llm-budget.service";
import { LLM_PROVIDER, LLM_PROVIDER_MAP } from "./llm.constants";
import { LlmController } from "./llm.controller";
import { LlmService } from "./llm.service";
import { ProviderProductionService } from "./provider-production.service";
import { createLlmProvider, createLlmProviderMap } from "./provider.factory";

/**
 * LLM 모듈 — Provider 선택은 Registry 기반 Provider Factory가 담당한다
 * (TASK-0903, `provider.factory.ts`). `LLM_PROVIDER` 환경 변수 하나로
 * mock(기본)/openai/anthropic/gemini를 전환하며, 키가 없으면 mock으로
 * 대체된다. 자세한 구조: docs/architecture/llm.md
 */
@Module({
  // 비용 계산에 쓰는 단가는 승인·적용된 가격표에서 온다 (TASK-3101, 정책 3101-①)
  imports: [ExecutionModule, AuthModule, PricingModule],
  controllers: [LlmController],
  providers: [
    LlmService,
    LlmBudgetService,
    ExperimentLifecycleService,
    ExperimentAnalyticsService,
    ProviderProductionService,
    {
      provide: LLM_PROVIDER,
      useFactory: createLlmProvider,
    },
    {
      // Cross-Provider Routing (TASK-1001) — 키가 설정된 Provider 전부
      provide: LLM_PROVIDER_MAP,
      useFactory: createLlmProviderMap,
    },
  ],
  exports: [
    LlmService,
    LlmBudgetService,
    ExperimentLifecycleService,
    ExperimentAnalyticsService,
    ProviderProductionService,
  ],
})
export class LlmModule {}
