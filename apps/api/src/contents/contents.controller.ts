import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import type {
  ContentDto,
  ContentStatusHistoryDto,
  GenerateContentRequest,
  UpdateContentStatusRequest,
} from "@acos/shared";
import { ContentGenerationService } from "./content-generation.service";
import { ContentsService } from "./contents.service";

@Controller("projects/:projectId/contents")
export class ContentsController {
  constructor(
    private readonly contentsService: ContentsService,
    private readonly contentGenerationService: ContentGenerationService,
  ) {}

  /**
   * @deprecated 구 Generator 경로 — 공식 엔진은 POST …/contents/generate.
   * TASK-0506에서 내부 구현이 공식 엔진으로 통합됨 (API 계약은 유지,
   * Wrapper가 공식 엔진 호출) — 신규 코드는 공식 경로를 사용할 것.
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

  /** 발행 파이프라인 상태 전이 (TASK-0703) — DRAFT → REVIEW → PUBLISHED → ARCHIVED */
  @Patch(":contentId/status")
  async updateStatus(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
    @Body() body?: UpdateContentStatusRequest,
  ): Promise<ContentDto> {
    return this.contentsService.updateStatus(
      projectId,
      contentId,
      body?.status ?? "",
    );
  }

  /** 발행 파이프라인 감사 이력 (TASK-0704) — 최신순 */
  @Get(":contentId/history")
  async getStatusHistory(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
  ): Promise<{ history: ContentStatusHistoryDto[] }> {
    return {
      history: await this.contentsService.getStatusHistory(
        projectId,
        contentId,
      ),
    };
  }

  @Get(":contentId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
  ): Promise<ContentDto> {
    return this.contentsService.getById(projectId, contentId);
  }
}
