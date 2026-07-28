import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { ContentDto, GenerateContentRequest } from "@acos/shared";
import { ContentGenerationService } from "./content-generation.service";
import { ContentsService } from "./contents.service";

@Controller("projects/:projectId/contents")
export class ContentsController {
  constructor(
    private readonly contentsService: ContentsService,
    private readonly contentGenerationService: ContentGenerationService,
  ) {}

  /**
   * @deprecated 구 mock Generator 경로 — 공식 엔진은 POST …/contents/generate.
   * 다음 Sprint에서 내부적으로 새 엔진을 호출하도록 통합 예정 (CTO 결정).
   */
  @Post()
  async generate(
    @Param("projectId") projectId: string,
    @Body() body?: GenerateContentRequest,
  ): Promise<ContentDto> {
    return this.contentsService.generate(projectId, body ?? {});
  }

  /**
   * Content Generation Engine (TASK-0502) —
   * READY Product Object + Company Brain + LLM Gateway로 Markdown 생성
   */
  @Post("generate")
  async generateWithEngine(
    @Param("projectId") projectId: string,
    @Body() body?: GenerateContentRequest,
  ): Promise<ContentDto> {
    return this.contentGenerationService.generate(projectId, body ?? {});
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
  ): Promise<{ contents: ContentDto[] }> {
    return { contents: await this.contentsService.list(projectId) };
  }

  @Get(":contentId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
  ): Promise<ContentDto> {
    return this.contentsService.getById(projectId, contentId);
  }
}
