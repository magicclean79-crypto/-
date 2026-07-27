import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { validateCreateMemory, validateUpdateMemory } from "@acos/core";
import type { Memory } from "@acos/core";
import { MEMORY_SCOPES } from "@acos/shared";
import type {
  CreateMemoryRequest,
  MemoryDto,
  MemoryScope,
  UpdateMemoryRequest,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
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
 * 표준 Structured Memory 서비스 (TASK-0402) — AI용 구조화 설정 저장소.
 * (scope, scopeId, key)가 저장 단위의 식별자다 — 같은 범위에 같은 key는
 * 한 번만 존재하며, 수정은 value/description만 허용된다.
 * scope 규칙(CTO 결정): GLOBAL/COMPANY → scopeId 없음,
 * PROJECT/PRODUCT → scopeId 실존 검증(projects/products).
 */
@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PrismaMemoryStore,
  ) {}

  async create(request: CreateMemoryRequest): Promise<MemoryDto> {
    const errors = validateCreateMemory(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    const scope = request.scope;
    const scopeId = request.scopeId?.trim() || null;
    const key = request.key.trim();

    await this.ensureScopeTarget(scope, scopeId);

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
    if (
      scope !== undefined &&
      !(MEMORY_SCOPES as readonly string[]).includes(scope)
    ) {
      throw new BadRequestException(
        `scope는 다음 중 하나여야 합니다: ${MEMORY_SCOPES.join(", ")}`,
      );
    }
    const memories = await this.store.findMany({
      ...(scope !== undefined ? { scope: scope as MemoryScope } : {}),
      ...(scopeId !== undefined ? { scopeId: scopeId || null } : {}),
    });
    return memories.map(toDto);
  }

  /** scope 규칙 (CTO 결정): PROJECT/PRODUCT는 대상 실존을 검증한다 */
  private async ensureScopeTarget(
    scope: MemoryScope,
    scopeId: string | null,
  ): Promise<void> {
    if (scope === "PROJECT" && scopeId) {
      const project = await this.prisma.project.findUnique({
        where: { id: scopeId },
        select: { id: true },
      });
      if (!project) {
        throw new BadRequestException(
          `존재하지 않는 프로젝트입니다: ${scopeId}`,
        );
      }
    }
    if (scope === "PRODUCT" && scopeId) {
      const product = await this.prisma.product.findUnique({
        where: { id: scopeId },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException(`존재하지 않는 상품입니다: ${scopeId}`);
      }
    }
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
