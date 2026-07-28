import { Module } from "@nestjs/common";
import { createDefaultPromptEngine } from "@acos/core";
import { PROMPT_ENGINE } from "./prompt.constants";
import { PromptController } from "./prompt.controller";

/**
 * Prompt Engine 모듈 (TASK-0503).
 * 모든 AI 기능은 이 모듈이 제공하는 PROMPT_ENGINE으로만 프롬프트를 만든다 —
 * 새 AI 기능은 @acos/core에 PromptTemplate을 추가하고
 * createDefaultPromptEngine에 등록하면 된다.
 */
@Module({
  controllers: [PromptController],
  providers: [
    {
      provide: PROMPT_ENGINE,
      useFactory: createDefaultPromptEngine,
    },
  ],
  exports: [PROMPT_ENGINE],
})
export class PromptModule {}
