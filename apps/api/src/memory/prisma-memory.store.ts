import { Injectable } from "@nestjs/common";
import type {
  CreateMemoryInput,
  Memory,
  MemoryStore,
  UpdateMemoryInput,
} from "@acos/core";
import type { MemoryScope } from "@acos/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** JSON null(값으로서의 null)을 Prisma가 요구하는 형태로 변환한다 */
function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/** @acos/core MemoryStore Port의 Prisma 어댑터 (표준 Structured Memory) */
@Injectable()
export class PrismaMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateMemoryInput): Promise<Memory> {
    return this.prisma.memory.create({
      data: {
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        key: input.key,
        value: toJsonValue(input.value),
        description: input.description ?? null,
      },
    });
  }

  async findById(id: string): Promise<Memory | null> {
    return this.prisma.memory.findUnique({ where: { id } });
  }

  async findByKey(
    scope: MemoryScope,
    scopeId: string | null,
    key: string,
  ): Promise<Memory | null> {
    return this.prisma.memory.findFirst({
      where: { scope, scopeId, key },
    });
  }

  async findMany(filter: {
    scope?: MemoryScope;
    scopeId?: string | null;
  }): Promise<Memory[]> {
    return this.prisma.memory.findMany({
      where: {
        ...(filter.scope !== undefined ? { scope: filter.scope } : {}),
        ...(filter.scopeId !== undefined ? { scopeId: filter.scopeId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory> {
    return this.prisma.memory.update({
      where: { id },
      data: {
        ...(input.value !== undefined ? { value: toJsonValue(input.value) } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.memory.delete({ where: { id } });
  }
}
