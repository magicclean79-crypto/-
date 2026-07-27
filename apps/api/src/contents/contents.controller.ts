import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { ContentDto, GenerateContentRequest } from "@acos/shared";
import { ContentsService } from "./contents.service";

@Controller("projects/:projectId/contents")
export class ContentsController {
  constructor(private readonly contentsService: ContentsService) {}

  /** 상세페이지 생성 — READY 상태 Product Object를 단일 입력으로 사용 */
  @Post()
  async generate(
    @Param("projectId") projectId: string,
    @Body() body?: GenerateContentRequest,
  ): Promise<ContentDto> {
    return this.contentsService.generate(projectId, body ?? {});
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
