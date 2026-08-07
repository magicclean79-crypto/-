import { Module } from "@nestjs/common";
import { DesignReviewEngine } from "@acos/core";
import type { PromptEngine } from "@acos/core";
import { LlmModule } from "../llm/llm.module";
import { LlmService } from "../llm/llm.service";
import { PromptModule } from "../prompt/prompt.module";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import { SharpImagePreprocessor } from "../product-object/sharp-image.preprocessor";
import { DesignReviewController } from "./design-review.controller";
import { DesignReviewService } from "./design-review.service";

/**
 * 디자인 리뷰 모듈. (Sprint 35 — "시장 디자인 패턴 학습" CTO 지시)
 *
 * `ProductProfileModule`과 같은 구조 — 모델/Provider 선택은 LLM Gateway의
 * 라우팅에 위임한다. `design-review` feature는
 * `packages/core/src/llm/routing.ts`의 `ROUTABLE_FEATURES`에 등록되어
 * 있어, `LLM_ROUTE_DESIGN_REVIEW=gemini` 환경변수만 설정하면 코드 변경
 * 없이 Gemini로 라우팅된다(현재는 미설정 — 기본 Provider로 내려간다).
 * Company Brain 의존이 없다 — 스크린샷만 넣으면 평가가 나와야 한다.
 */
@Module({
  imports: [LlmModule, PromptModule],
  controllers: [DesignReviewController],
  providers: [
    DesignReviewService,
    {
      provide: DesignReviewEngine,
      useFactory: (llm: LlmService, promptEngine: PromptEngine) =>
        new DesignReviewEngine({
          promptEngine,
          llmProviderName: llm.info().provider,
          imagePreprocessor: new SharpImagePreprocessor(),
          complete: async ({ messages, images, responseFormat }) => {
            const completion = await llm.complete(
              { messages, images, responseFormat },
              { feature: "design-review" },
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
  exports: [DesignReviewService],
})
export class DesignReviewModule {}
