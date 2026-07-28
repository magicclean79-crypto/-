import { Module } from "@nestjs/common";
import { CompanyBrainModule } from "../company-brain/company-brain.module";
import { LlmModule } from "../llm/llm.module";
import { PromptModule } from "../prompt/prompt.module";
import { ContentGenerationService } from "./content-generation.service";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";
import { EngineContentGenerator } from "./engine-content.generator";

/**
 * 구 Generator 경로는 EngineContentGenerator(Wrapper)를 통해 공식
 * Content Generation Engine을 호출한다. (TASK-0506 — CTO 결정)
 * CONTENT_GENERATOR 환경 변수 선택은 제거되었다 — 모델 선택은 LLM Gateway의
 * LLM_PROVIDER 하나로 관리된다. (구 MockContentGenerator는 @acos/core에
 * @deprecated 상태로 보존되어 있으나 더 이상 연결되지 않는다.)
 */
@Module({
  imports: [CompanyBrainModule, LlmModule, PromptModule],
  controllers: [ContentsController],
  providers: [
    ContentsService,
    ContentGenerationService,
    {
      provide: CONTENT_GENERATOR,
      useFactory: (engine: ContentGenerationService) =>
        new EngineContentGenerator(engine),
      inject: [ContentGenerationService],
    },
  ],
  exports: [ContentsService, ContentGenerationService],
})
export class ContentsModule {}
