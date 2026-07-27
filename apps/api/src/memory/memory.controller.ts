import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type {
  CreateMemoryRequest,
  MemoryDto,
  UpdateMemoryRequest,
} from "@acos/shared";
import { MemoryService } from "./memory.service";

/** 표준 Structured Memory — scope 기반이라 최상위 경로를 쓴다 */
@Controller("memory")
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  async create(@Body() body: CreateMemoryRequest): Promise<MemoryDto> {
    return this.memoryService.create(body ?? ({} as CreateMemoryRequest));
  }

  @Get()
  async list(
    @Query("scope") scope?: string,
    @Query("scopeId") scopeId?: string,
  ): Promise<{ memories: MemoryDto[] }> {
    return { memories: await this.memoryService.list(scope, scopeId) };
  }

  @Get(":memoryId")
  async getById(@Param("memoryId") memoryId: string): Promise<MemoryDto> {
    return this.memoryService.getById(memoryId);
  }

  @Patch(":memoryId")
  async update(
    @Param("memoryId") memoryId: string,
    @Body() body: UpdateMemoryRequest,
  ): Promise<MemoryDto> {
    return this.memoryService.update(memoryId, body ?? {});
  }

  @Delete(":memoryId")
  @HttpCode(204)
  async delete(@Param("memoryId") memoryId: string): Promise<void> {
    await this.memoryService.delete(memoryId);
  }
}
