import { Injectable } from "@nestjs/common";
import type {
  CreateKnowledgeInput,
  Knowledge,
  KnowledgeRepository,
  UpdateKnowledgeInput,
} from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/** @acos/core KnowledgeRepository Port의 Prisma 어댑터 */
@Injectable()
export class PrismaKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateKnowledgeInput): Promise<Knowledge> {
    return this.prisma.knowledge.create({
      data: {
        title: input.title,
        content: input.content,
        category: input.category ?? null,
      },
    });
  }

  async findById(id: string): Promise<Knowledge | null> {
    return this.prisma.knowledge.findUnique({ where: { id } });
  }

  async findAll(): Promise<Knowledge[]> {
    return this.prisma.knowledge.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, input: UpdateKnowledgeInput): Promise<Knowledge> {
    return this.prisma.knowledge.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.knowledge.delete({ where: { id } });
  }
}
