import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ExecutionModule } from "../execution/execution.module";
import { LlmBudgetService } from "./llm-budget.service";
import { LLM_PROVIDER } from "./llm.constants";
import { LlmController } from "./llm.controller";
import { LlmService } from "./llm.service";
import { createLlmProvider } from "./provider.factory";

/**
 * LLM 모듈 — Provider 선택은 Registry 기반 Provider Factory가 담당한다
 * (TASK-0903, `provider.factory.ts`). `LLM_PROVIDER` 환경 변수 하나로
 * mock(기본)/openai/anthropic/gemini를 전환하며, 키가 없으면 mock으로
 * 대체된다. 자세한 구조: docs/architecture/llm.md
 */
@Module({
  imports: [ExecutionModule, AuthModule],
  controllers: [LlmController],
  providers: [
    LlmService,
    LlmBudgetService,
    {
      provide: LLM_PROVIDER,
      useFactory: createLlmProvider,
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}
