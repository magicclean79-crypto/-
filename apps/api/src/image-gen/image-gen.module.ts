import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { PromptModule } from "../prompt/prompt.module";
import { createImageEditProvider } from "./image-edit-provider.factory";
import { GeneratedCompositionValidatorService } from "./generated-composition-validator.service";
import { ImageGenController } from "./image-gen.controller";
import { IMAGE_EDIT_PROVIDER } from "./image-gen.constants";
import { ImageGenService } from "./image-gen.service";

/**
 * 이미지 생성/편집 모듈. (Sprint 36 — CTO 지시: Gemini 역할 재정의 —
 * 디자인 심사가 아니라 배경 제거·배경 생성·제품 합성·Hero 이미지 생성.)
 * `LlmModule`(TASK-0903)과 같은 Provider Factory 원칙 — `GEMINI_API_KEY`가
 * 없으면 mock으로 대체해 키 미설정 환경에서도 항상 기동한다.
 */
@Module({
  imports: [LlmModule, PromptModule],
  controllers: [ImageGenController],
  providers: [
    ImageGenService,
    GeneratedCompositionValidatorService,
    {
      provide: IMAGE_EDIT_PROVIDER,
      useFactory: createImageEditProvider,
    },
  ],
  exports: [ImageGenService],
})
export class ImageGenModule {}
