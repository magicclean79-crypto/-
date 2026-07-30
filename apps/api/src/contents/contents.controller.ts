import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  ContentDto,
  ContentGovernanceDto,
  ContentGovernanceRecordDto,
  ContentStatusHistoryDto,
  GenerateContentRequest,
  UpdateContentStatusRequest,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { ContentGovernanceService } from "../content-governance/content-governance.service";
import { ContentGenerationService } from "./content-generation.service";
import { ContentsService } from "./contents.service";

@Controller("projects/:projectId/contents")
export class ContentsController {
  constructor(
    private readonly contentsService: ContentsService,
    private readonly contentGenerationService: ContentGenerationService,
    private readonly governanceService: ContentGovernanceService,
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

  /**
   * 발행 파이프라인 상태 전이 (TASK-0703) — DRAFT → REVIEW → PUBLISHED → ARCHIVED.
   * TASK-0801: EDITOR 이상 인증 필요, 수행자가 감사 이력(actor)에 기록된다.
   */
  @Patch(":contentId/status")
  @UseGuards(AuthGuard)
  @RequireRole("EDITOR")
  async updateStatus(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body?: UpdateContentStatusRequest,
  ): Promise<ContentDto> {
    return this.contentsService.updateStatus(
      projectId,
      contentId,
      body?.status ?? "",
      request.user?.email ?? null,
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

  /**
   * 발행 거버넌스 판정 미리보기 (TASK-2501) — 전이하지 않고 판정만.
   *
   * 발행 버튼을 누르기 전에 무엇이 막는지 보기 위한 것이다. 발행 게이트와
   * **같은 판정 함수**를 부르므로, 여기서 "발행 가능"이면 눌러도 막히지 않는다.
   * 기록은 남기지 않는다 — 보는 것과 시도하는 것은 다르다.
   */
  @Get(":contentId/governance")
  async governance(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
  ): Promise<ContentGovernanceDto> {
    return this.governanceService.evaluate(projectId, contentId);
  }

  /**
   * 발행 거버넌스 판정 기록 (TASK-2501) — 최신순. 막힌 기록도 남아 있다.
   *
   * 보관된 기록(90일 경과, CTO 결정 2501-⑤)은 기본으로 담지 않는다 — 보관은
   * 현황에서 비켜 두는 것이다. `?includeArchived=1`로 볼 수 있다:
   * **볼 길이 없으면 보관이 사실상 삭제가 된다.**
   */
  @Get(":contentId/governance/history")
  async governanceHistory(
    @Param("projectId") projectId: string,
    @Param("contentId") contentId: string,
    @Query("includeArchived") includeArchived?: string,
  ): Promise<{ records: ContentGovernanceRecordDto[] }> {
    return {
      records: await this.governanceService.history(projectId, contentId, {
        includeArchived: ["1", "true", "yes"].includes(
          (includeArchived ?? "").trim().toLowerCase(),
        ),
      }),
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
