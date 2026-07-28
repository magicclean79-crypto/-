import { Module } from "@nestjs/common";
import { LlmAnalysisProvider } from "@acos/core";
import type { PromptEngine } from "@acos/core";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { LlmModule } from "../llm/llm.module";
import { LlmService } from "../llm/llm.service";
import { PromptModule } from "../prompt/prompt.module";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import { ANALYSIS_PROVIDER } from "./analysis.constants";
import { createAnalysisCompanyBrainSource } from "./analysis-company-brain";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { PrismaAnalysisRunStore } from "./prisma-analysis-run.store";

/**
 * 공식 분석 엔진 — LLM 기반 Analysis Provider. (TASK-0504)
 *
 * 구 MockAnalysisProvider(ANALYSIS_PROVIDER 환경변수 선택)를 교체했다.
 * 모델 선택은 이제 LLM Gateway의 LLM_PROVIDER 환경변수 하나로 관리된다
 * (기본 mock — 실제 API 미호출, 키 설정 시 openai/anthropic/gemini).
 * 자세한 구조: docs/architecture/analysis.md
 */
@Module({
  imports: [LlmModule, PromptModule, CompanyBrainModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    PrismaAnalysisRunStore,
    {
      provide: ANALYSIS_PROVIDER,
      useFactory: (
        llm: LlmService,
        promptEngine: PromptEngine,
        companyBrain: CompanyBrainService,
      ) =>
        new LlmAnalysisProvider({
          promptEngine,
          llmProviderName: llm.info().provider,
          complete: async ({ messages, responseFormat, projectId }) => {
            const completion = await llm.complete(
              { messages, responseFormat },
              { feature: "product-analysis", projectId },
            );
            return {
              provider: completion.provider,
              model: completion.model,
              text: completion.text,
            };
          },
          loadCompanyBrain: createAnalysisCompanyBrainSource(companyBrain),
        }),
      inject: [LlmService, PROMPT_ENGINE, CompanyBrainService],
    },
  ],
})
export class AnalysisModule {}
