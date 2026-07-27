import { Injectable } from "@nestjs/common";
import type {
  CreateDecisionInput,
  Decision,
  DecisionRepository,
  UpdateDecisionInput,
} from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";

/** @acos/core DecisionRepository Port의 Prisma 어댑터 */
@Injectable()
export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateDecisionInput): Promise<Decision> {
    return this.prisma.decision.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? null,
        reason: input.reason,
        decisionType: input.decisionType,
        author: input.author,
      },
    });
  }

  async findById(id: string): Promise<Decision | null> {
    return this.prisma.decision.findUnique({ where: { id } });
  }

  async findByProjectId(projectId: string): Promise<Decision[]> {
    return this.prisma.decision.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, input: UpdateDecisionInput): Promise<Decision> {
    return this.prisma.decision.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.decisionType !== undefined
          ? { decisionType: input.decisionType }
          : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.decision.delete({ where: { id } });
  }
}
