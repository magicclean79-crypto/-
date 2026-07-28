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

  /** 상세페이지 생성 (TASK-0303 mock Generator 경로 — 기존 기능 보존) */
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
