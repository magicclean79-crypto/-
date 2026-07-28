import { Module } from "@nestjs/common";
import { LlmVisionProvider } from "@acos/core";
import type { PromptEngine } from "@acos/core";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { LlmModule } from "../llm/llm.module";
import { LlmService } from "../llm/llm.service";
import { PromptModule } from "../prompt/prompt.module";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import { ProductObjectController } from "./product-object.controller";
import { ProductObjectService } from "./product-object.service";
import { VISION_PROVIDER } from "./vision.constants";
import { createVisionCompanyBrainSource } from "./vision-company-brain";

/**
 * 공식 Vision 엔진 — LLM 기반 멀티모달 Vision Provider. (TASK-0505)
 *
 * 구 MockVisionProvider(VISION_PROVIDER 환경변수 선택)를 교체했다.
 * 모델 선택은 LLM Gateway의 LLM_PROVIDER 환경변수 하나로 관리된다
 * (기본 mock — 실제 API 미호출). 자세한 구조: docs/architecture/vision.md
 */
@Module({
  imports: [LlmModule, PromptModule, CompanyBrainModule],
  controllers: [ProductObjectController],
  providers: [
    ProductObjectService,
    {
      provide: VISION_PROVIDER,
      useFactory: (
        llm: LlmService,
        promptEngine: PromptEngine,
        companyBrain: CompanyBrainService,
      ) =>
        new LlmVisionProvider({
          promptEngine,
          llmProviderName: llm.info().provider,
          complete: async ({ messages, images, responseFormat }) => {
            const completion = await llm.complete({
              messages,
              images,
              responseFormat,
            });
            return {
              provider: completion.provider,
              model: completion.model,
              text: completion.text,
            };
          },
          loadCompanyBrain: createVisionCompanyBrainSource(companyBrain),
        }),
      inject: [LlmService, PROMPT_ENGINE, CompanyBrainService],
    },
  ],
  exports: [ProductObjectService],
})
export class ProductObjectModule {}
