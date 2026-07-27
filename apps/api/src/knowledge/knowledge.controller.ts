import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  CreateKnowledgeRequest,
  KnowledgeDto,
  UpdateKnowledgeRequest,
} from "@acos/shared";
import { KnowledgeService } from "./knowledge.service";

/** 회사 전역 지식 — 프로젝트에 속하지 않으므로 최상위 경로를 쓴다 */
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  async create(@Body() body: CreateKnowledgeRequest): Promise<KnowledgeDto> {
    return this.knowledgeService.create(
      body ?? ({} as CreateKnowledgeRequest),
    );
  }

  @Get()
  async list(): Promise<{ knowledge: KnowledgeDto[] }> {
    return { knowledge: await this.knowledgeService.list() };
  }

  @Get(":knowledgeId")
  async getById(
    @Param("knowledgeId") knowledgeId: string,
  ): Promise<KnowledgeDto> {
    return this.knowledgeService.getById(knowledgeId);
  }

  @Patch(":knowledgeId")
  async update(
    @Param("knowledgeId") knowledgeId: string,
    @Body() body: UpdateKnowledgeRequest,
  ): Promise<KnowledgeDto> {
    return this.knowledgeService.update(knowledgeId, body ?? {});
  }

  @Delete(":knowledgeId")
  @HttpCode(204)
  async delete(@Param("knowledgeId") knowledgeId: string): Promise<void> {
    await this.knowledgeService.delete(knowledgeId);
  }
}
