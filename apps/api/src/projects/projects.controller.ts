import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type {
  CreateProjectRequest,
  ProjectDetailDto,
  ProjectDto,
  ProjectListItemDto,
  UpdateProjectRequest,
} from "@acos/shared";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(@Body() body: CreateProjectRequest): Promise<ProjectDto> {
    return this.projectsService.create(body ?? { name: "" });
  }

  @Get()
  async list(
    @Query("take") take?: string,
  ): Promise<{ projects: ProjectListItemDto[] }> {
    return { projects: await this.projectsService.list(Number(take ?? "20")) };
  }

  @Get(":id")
  async getById(@Param("id") id: string): Promise<ProjectDetailDto> {
    return this.projectsService.getById(id);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateProjectRequest,
  ): Promise<ProjectDto> {
    return this.projectsService.update(id, body ?? {});
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    return this.projectsService.remove(id);
  }
}
