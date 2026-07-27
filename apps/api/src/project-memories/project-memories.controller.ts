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
  CreateProjectMemoryRequest,
  ProjectMemoryDto,
  UpdateProjectMemoryRequest,
} from "@acos/shared";
import { ProjectMemoriesService } from "./project-memories.service";

@Controller("projects/:projectId/memories")
export class ProjectMemoriesController {
  constructor(private readonly memoriesService: ProjectMemoriesService) {}

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateProjectMemoryRequest,
  ): Promise<ProjectMemoryDto> {
    return this.memoriesService.create(
      projectId,
      body ?? ({} as CreateProjectMemoryRequest),
    );
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
  ): Promise<{ memories: ProjectMemoryDto[] }> {
    return { memories: await this.memoriesService.list(projectId) };
  }

  @Get(":memoryId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
  ): Promise<ProjectMemoryDto> {
    return this.memoriesService.getById(projectId, memoryId);
  }

  @Patch(":memoryId")
  async update(
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: UpdateProjectMemoryRequest,
  ): Promise<ProjectMemoryDto> {
    return this.memoriesService.update(projectId, memoryId, body ?? {});
  }

  @Delete(":memoryId")
  @HttpCode(204)
  async delete(
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
  ): Promise<void> {
    await this.memoriesService.delete(projectId, memoryId);
  }
}
