import { Module } from "@nestjs/common";
import { ProductProfileEngine } from "@acos/core";
import type { PromptEngine } from "@acos/core";
import { LlmModule } from "../llm/llm.module";
import { LlmService } from "../llm/llm.service";
import { PromptModule } from "../prompt/prompt.module";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import { SharpImagePreprocessor } from "../product-object/sharp-image.preprocessor";
import { PrismaProductProfileRunStore } from "./prisma-product-profile-run.store";
import { ProductProfileController } from "./product-profile.controller";
import { ProductProfileService } from "./product-profile.service";

/**
 * Product Detail Engine V1 모듈. (TASK-5601, Sprint 35 — CTO 지시
 * "Sprint 35 Phase 1")
 *
 * `ProductObjectModule`(TASK-0505)의 Vision 팩토리와 같은 구조를 따르되
 * Company Brain 의존이 없다 — "사진만 넣으면"이 V1의 전제다. 모델 선택은
 * LLM Gateway의 `LLM_PROVIDER` 환경변수 하나로 관리된다(기본 mock — 실제
 * API 미호출). 이미지 검증/전처리(리사이즈·EXIF 제거)는 Vision과 같은
 * `SharpImagePreprocessor`를 재사용한다.
 */
@Module({
  imports: [LlmModule, PromptModule],
  controllers: [ProductProfileController],
  providers: [
    ProductProfileService,
    PrismaProductProfileRunStore,
    {
      provide: ProductProfileEngine,
      useFactory: (llm: LlmService, promptEngine: PromptEngine) =>
        new ProductProfileEngine({
          promptEngine,
          llmProviderName: llm.info().provider,
          imagePreprocessor: new SharpImagePreprocessor(),
          complete: async ({ messages, images, responseFormat, step, projectId }) => {
            const completion = await llm.complete(
              { messages, images, responseFormat },
              {
                feature:
                  step === "vision"
                    ? "product-profile-vision"
                    : "product-profile-synthesis",
                projectId,
              },
            );
            return {
              provider: completion.provider,
              model: completion.model,
              text: completion.text,
            };
          },
        }),
      inject: [LlmService, PROMPT_ENGINE],
    },
  ],
  exports: [ProductProfileService],
})
export class ProductProfileModule {}
