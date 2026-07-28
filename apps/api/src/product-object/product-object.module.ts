import { Module } from "@nestjs/common";
import { DEFAULT_IMAGE_GUARD_POLICY, LlmVisionProvider } from "@acos/core";
import type { ImageGuardPolicy, PromptEngine } from "@acos/core";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { LlmModule } from "../llm/llm.module";
import { LlmService } from "../llm/llm.service";
import { PromptModule } from "../prompt/prompt.module";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import { ProductObjectController } from "./product-object.controller";
import { ProductObjectService } from "./product-object.service";
import { SharpImagePreprocessor } from "./sharp-image.preprocessor";
import { VISION_PROVIDER } from "./vision.constants";
import { createVisionCompanyBrainSource } from "./vision-company-brain";

/** Image Guard 정책 (TASK-0604) — 환경변수로 조정 가능, 기본값은 core 정의 */
function createImageGuardPolicy(): ImageGuardPolicy {
  const number = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    ...DEFAULT_IMAGE_GUARD_POLICY,
    maxSourceBytes: number(
      process.env.VISION_IMAGE_MAX_SOURCE_BYTES,
      DEFAULT_IMAGE_GUARD_POLICY.maxSourceBytes,
    ),
    maxDimension: number(
      process.env.VISION_IMAGE_MAX_DIMENSION,
      DEFAULT_IMAGE_GUARD_POLICY.maxDimension,
    ),
    maxOutputBytes: number(
      process.env.VISION_IMAGE_MAX_OUTPUT_BYTES,
      DEFAULT_IMAGE_GUARD_POLICY.maxOutputBytes,
    ),
  };
}

/**
 * 공식 Vision 엔진 — LLM 기반 멀티모달 Vision Provider. (TASK-0505)
 *
 * 구 MockVisionProvider(VISION_PROVIDER 환경변수 선택)를 교체했다.
 * 모델 선택은 LLM Gateway의 LLM_PROVIDER 환경변수 하나로 관리된다
 * (기본 mock — 실제 API 미호출). TASK-0604: 호출 전 이미지 검증·리사이즈·
 * 최적화·EXIF 제거·용량 제한(SharpImagePreprocessor)이 적용된다.
 * 자세한 구조: docs/architecture/vision.md
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
          // CTO 결정(TASK-0505 승인 ①): 이미지 상한은 환경변수로 조정 가능
          maxImages: Number(process.env.VISION_MAX_IMAGES ?? 5) || 5,
          // Image Guard & Preprocessing (TASK-0604)
          imagePreprocessor: new SharpImagePreprocessor(),
          imagePolicy: createImageGuardPolicy(),
          complete: async ({ messages, images, responseFormat }) => {
            const completion = await llm.complete(
              { messages, images, responseFormat },
              { feature: "vision-analysis" },
            );
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
