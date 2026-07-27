import { Injectable } from "@nestjs/common";
import type {
  CreateMemoryInput,
  Memory,
  MemoryStore,
  UpdateMemoryInput,
} from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/** @acos/core MemoryStore Port의 Prisma 어댑터 */
@Injectable()
export class PrismaMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateMemoryInput): Promise<Memory> {
    return this.prisma.memory.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        content: input.content,
        source: input.source ?? null,
      },
    });
  }

  async findById(id: string): Promise<Memory | null> {
    return this.prisma.memory.findUnique({ where: { id } });
  }

  async findByProjectId(projectId: string): Promise<Memory[]> {
    return this.prisma.memory.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory> {
    return this.prisma.memory.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.memory.delete({ where: { id } });
  }
}
