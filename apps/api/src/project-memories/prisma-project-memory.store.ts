import { Injectable } from "@nestjs/common";
import type {
  CreateProjectMemoryInput,
  ProjectMemory,
  ProjectMemoryStore,
  UpdateProjectMemoryInput,
} from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/** @acos/core ProjectMemoryStore Port의 Prisma 어댑터 */
@Injectable()
export class PrismaProjectMemoryStore implements ProjectMemoryStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateProjectMemoryInput): Promise<ProjectMemory> {
    return this.prisma.projectMemory.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        content: input.content,
        source: input.source ?? null,
      },
    });
  }

  async findById(id: string): Promise<ProjectMemory | null> {
    return this.prisma.projectMemory.findUnique({ where: { id } });
  }

  async findByProjectId(projectId: string): Promise<ProjectMemory[]> {
    return this.prisma.projectMemory.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, input: UpdateProjectMemoryInput): Promise<ProjectMemory> {
    return this.prisma.projectMemory.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.projectMemory.delete({ where: { id } });
  }
}
