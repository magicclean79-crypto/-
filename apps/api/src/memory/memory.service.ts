import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { validateCreateMemory, validateUpdateMemory } from "@acos/core";
import type { Memory } from "@acos/core";
import type {
  CreateMemoryRequest,
  MemoryDto,
  UpdateMemoryRequest,
} from "@acos/shared";
import { PrismaMemoryStore } from "./prisma-memory.store";

function toDto(memory: Memory): MemoryDto {
  return {
    id: memory.id,
    scope: memory.scope,
    scopeId: memory.scopeId,
    key: memory.key,
    value: memory.value,
    description: memory.description,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

/**
 * 표준 Structured Memory 서비스 (TASK-0402).
 * (scope, scopeId, key)가 저장 단위의 식별자다 — 같은 범위에 같은 key는
 * 한 번만 존재하며, 수정은 value/description만 허용된다.
 */
@Injectable()
export class MemoryService {
  constructor(private readonly store: PrismaMemoryStore) {}

  async create(request: CreateMemoryRequest): Promise<MemoryDto> {
    const errors = validateCreateMemory(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    const scope = request.scope.trim();
    const scopeId = request.scopeId?.trim() || null;
    const key = request.key.trim();

    const existing = await this.store.findByKey(scope, scopeId, key);
    if (existing) {
      throw new BadRequestException(
        `이미 존재하는 key입니다: (${scope}, ${scopeId ?? "-"}, ${key}) — ` +
          `수정은 PATCH /memory/${existing.id} 를 사용해 주세요.`,
      );
    }

    const memory = await this.store.create({
      scope,
      scopeId,
      key,
      value: request.value,
      description: request.description?.trim() || null,
    });
    return toDto(memory);
  }

  /** scope/scopeId로 필터링한 목록 (최신순) */
  async list(scope?: string, scopeId?: string): Promise<MemoryDto[]> {
    const memories = await this.store.findMany({
      ...(scope !== undefined ? { scope } : {}),
      ...(scopeId !== undefined ? { scopeId: scopeId || null } : {}),
    });
    return memories.map(toDto);
  }

  async getById(memoryId: string): Promise<MemoryDto> {
    const memory = await this.findOrThrow(memoryId);
    return toDto(memory);
  }

  async update(
    memoryId: string,
    request: UpdateMemoryRequest,
  ): Promise<MemoryDto> {
    await this.findOrThrow(memoryId);

    const errors = validateUpdateMemory(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    const memory = await this.store.update(memoryId, {
      ...(request.value !== undefined ? { value: request.value } : {}),
      ...(request.description !== undefined
        ? { description: request.description?.trim() || null }
        : {}),
    });
    return toDto(memory);
  }

  async delete(memoryId: string): Promise<void> {
    await this.findOrThrow(memoryId);
    await this.store.delete(memoryId);
  }

  private async findOrThrow(memoryId: string): Promise<Memory> {
    const memory = await this.store.findById(memoryId);
    if (!memory) {
      throw new NotFoundException(`Memory를 찾을 수 없습니다: ${memoryId}`);
    }
    return memory;
  }
}
