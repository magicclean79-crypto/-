import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  validateCreateDecision,
  validateUpdateDecision,
} from "@acos/core";
import type { Decision } from "@acos/core";
import type {
  CreateDecisionRequest,
  DecisionDto,
  UpdateDecisionRequest,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { PrismaDecisionRepository } from "./prisma-decision.repository";

function toDto(decision: Decision): DecisionDto {
  return {
    id: decision.id,
    projectId: decision.projectId,
    title: decision.title,
    description: decision.description,
    reason: decision.reason,
    decisionType: decision.decisionType,
    author: decision.author,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}

/**
 * Decision Log 서비스 (TASK-0306).
 * 검증 규칙은 @acos/core(decision 도메인)에, 저장은 Repository Port 뒤에 있다.
 */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PrismaDecisionRepository,
  ) {}

  async create(
    projectId: string,
    request: CreateDecisionRequest,
  ): Promise<DecisionDto> {
    await this.ensureProject(projectId);

    const errors = validateCreateDecision(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    const decision = await this.repository.create({
      projectId,
      title: request.title.trim(),
      description: request.description?.trim() || null,
      reason: request.reason.trim(),
      decisionType: request.decisionType,
      author: request.author.trim(),
    });
    return toDto(decision);
  }

  async list(projectId: string): Promise<DecisionDto[]> {
    await this.ensureProject(projectId);
    const decisions = await this.repository.findByProjectId(projectId);
    return decisions.map(toDto);
  }

  async getById(projectId: string, decisionId: string): Promise<DecisionDto> {
    const decision = await this.findOwned(projectId, decisionId);
    return toDto(decision);
  }

  async update(
    projectId: string,
    decisionId: string,
    request: UpdateDecisionRequest,
  ): Promise<DecisionDto> {
    await this.findOwned(projectId, decisionId);

    const errors = validateUpdateDecision(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    const decision = await this.repository.update(decisionId, {
      ...(request.title !== undefined ? { title: request.title.trim() } : {}),
      ...(request.description !== undefined
        ? { description: request.description?.trim() || null }
        : {}),
      ...(request.reason !== undefined
        ? { reason: request.reason.trim() }
        : {}),
      ...(request.decisionType !== undefined
        ? { decisionType: request.decisionType }
        : {}),
      ...(request.author !== undefined
        ? { author: request.author.trim() }
        : {}),
    });
    return toDto(decision);
  }

  async delete(projectId: string, decisionId: string): Promise<void> {
    await this.findOwned(projectId, decisionId);
    await this.repository.delete(decisionId);
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
    decisionId: string,
  ): Promise<Decision> {
    const decision = await this.repository.findById(decisionId);
    if (!decision || decision.projectId !== projectId) {
      throw new NotFoundException(`결정을 찾을 수 없습니다: ${decisionId}`);
    }
    return decision;
  }
}
