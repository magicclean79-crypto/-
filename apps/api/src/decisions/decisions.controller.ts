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
  CreateDecisionRequest,
  DecisionDto,
  UpdateDecisionRequest,
} from "@acos/shared";
import { DecisionsService } from "./decisions.service";

@Controller("projects/:projectId/decisions")
export class DecisionsController {
  constructor(private readonly decisionsService: DecisionsService) {}

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateDecisionRequest,
  ): Promise<DecisionDto> {
    return this.decisionsService.create(projectId, body ?? ({} as CreateDecisionRequest));
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
  ): Promise<{ decisions: DecisionDto[] }> {
    return { decisions: await this.decisionsService.list(projectId) };
  }

  @Get(":decisionId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("decisionId") decisionId: string,
  ): Promise<DecisionDto> {
    return this.decisionsService.getById(projectId, decisionId);
  }

  @Patch(":decisionId")
  async update(
    @Param("projectId") projectId: string,
    @Param("decisionId") decisionId: string,
    @Body() body: UpdateDecisionRequest,
  ): Promise<DecisionDto> {
    return this.decisionsService.update(projectId, decisionId, body ?? {});
  }

  @Delete(":decisionId")
  @HttpCode(204)
  async delete(
    @Param("projectId") projectId: string,
    @Param("decisionId") decisionId: string,
  ): Promise<void> {
    await this.decisionsService.delete(projectId, decisionId);
  }
}
