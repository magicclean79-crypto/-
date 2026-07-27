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
  CreateMemoryRequest,
  MemoryDto,
  UpdateMemoryRequest,
} from "@acos/shared";
import { MemoriesService } from "./memories.service";

@Controller("projects/:projectId/memories")
export class MemoriesController {
  constructor(private readonly memoriesService: MemoriesService) {}

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateMemoryRequest,
  ): Promise<MemoryDto> {
    return this.memoriesService.create(
      projectId,
      body ?? ({} as CreateMemoryRequest),
    );
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
  ): Promise<{ memories: MemoryDto[] }> {
    return { memories: await this.memoriesService.list(projectId) };
  }

  @Get(":memoryId")
  async getById(
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
  ): Promise<MemoryDto> {
    return this.memoriesService.getById(projectId, memoryId);
  }

  @Patch(":memoryId")
  async update(
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: UpdateMemoryRequest,
  ): Promise<MemoryDto> {
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
