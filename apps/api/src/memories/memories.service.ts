import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MemoryEngine, MemoryValidationError } from "@acos/core";
import type { Memory } from "@acos/core";
import type {
  CreateMemoryRequest,
  MemoryDto,
  UpdateMemoryRequest,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { PrismaMemoryStore } from "./prisma-memory.store";

function toDto(memory: Memory): MemoryDto {
  return {
    id: memory.id,
    projectId: memory.projectId,
    title: memory.title,
    content: memory.content,
    source: memory.source,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

/**
 * Memory 서비스 (TASK-0307).
 * 기억의 기록/회상/수정/삭제는 @acos/core의 MemoryEngine(Company Brain)이
 * 담당하고, 이 서비스는 프로젝트 존재 확인과 HTTP 오류 매핑만 한다.
 */
@Injectable()
export class MemoriesService {
  private readonly engine: MemoryEngine;

  constructor(
    private readonly prisma: PrismaService,
    store: PrismaMemoryStore,
  ) {
    this.engine = new MemoryEngine(store);
  }

  async create(
    projectId: string,
    request: CreateMemoryRequest,
  ): Promise<MemoryDto> {
    await this.ensureProject(projectId);
    try {
      const memory = await this.engine.remember({
        projectId,
        title: request.title,
        content: request.content,
        source: request.source,
      });
      return toDto(memory);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async list(projectId: string): Promise<MemoryDto[]> {
    await this.ensureProject(projectId);
    const memories = await this.engine.recall(projectId);
    return memories.map(toDto);
  }

  async getById(projectId: string, memoryId: string): Promise<MemoryDto> {
    const memory = await this.findOwned(projectId, memoryId);
    return toDto(memory);
  }

  async update(
    projectId: string,
    memoryId: string,
    request: UpdateMemoryRequest,
  ): Promise<MemoryDto> {
    await this.findOwned(projectId, memoryId);
    try {
      const memory = await this.engine.revise(memoryId, request);
      return toDto(memory);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async delete(projectId: string, memoryId: string): Promise<void> {
    await this.findOwned(projectId, memoryId);
    await this.engine.forget(memoryId);
  }

  private mapError(error: unknown): Error {
    if (error instanceof MemoryValidationError) {
      return new BadRequestException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private async ensureProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }
  }

  private async findOwned(
    projectId: string,
    memoryId: string,
  ): Promise<Memory> {
    const memory = await this.engine.get(memoryId);
    if (!memory || memory.projectId !== projectId) {
      throw new NotFoundException(`기억을 찾을 수 없습니다: ${memoryId}`);
    }
    return memory;
  }
}
