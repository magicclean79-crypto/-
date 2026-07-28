import { Controller, Get, Inject } from "@nestjs/common";
import type { PromptEngine } from "@acos/core";
import type { PromptTemplateInfoDto } from "@acos/shared";
import { PROMPT_ENGINE } from "./prompt.constants";

@Controller("prompt")
export class PromptController {
  constructor(
    @Inject(PROMPT_ENGINE) private readonly promptEngine: PromptEngine,
  ) {}

  /** 등록된 프롬프트 템플릿 목록 — 모든 AI 기능의 프롬프트 단일 원천 */
  @Get("templates")
  templates(): { templates: PromptTemplateInfoDto[] } {
    return { templates: this.promptEngine.list() };
  }
}
