import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  validateCreateKnowledge,
  validateUpdateKnowledge,
} from "@acos/core";
import type { Knowledge } from "@acos/core";
import type {
  CreateKnowledgeRequest,
  KnowledgeDto,
  UpdateKnowledgeRequest,
} from "@acos/shared";
import { PrismaKnowledgeRepository } from "./prisma-knowledge.repository";

function toDto(knowledge: Knowledge): KnowledgeDto {
  return {
    id: knowledge.id,
    title: knowledge.title,
    content: knowledge.content,
    category: knowledge.category,
    createdAt: knowledge.createdAt.toISOString(),
    updatedAt: knowledge.updatedAt.toISOString(),
  };
}

/**
 * Knowledge 서비스 (TASK-0401).
 * 회사 전역 지식이라 프로젝트 확인이 없다 — 검증 규칙은 @acos/core
 * (knowledge 도메인)에, 저장은 Repository Port 뒤에 있다.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly repository: PrismaKnowledgeRepository) {}

  async create(request: CreateKnowledgeRequest): Promise<KnowledgeDto> {
    const errors = validateCreateKnowledge(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }
    const knowledge = await this.repository.create({
      title: request.title.trim(),
      content: request.content.trim(),
      category: request.category?.trim() || null,
    });
    return toDto(knowledge);
  }

  async list(): Promise<KnowledgeDto[]> {
    const items = await this.repository.findAll();
    return items.map(toDto);
  }

  async getById(knowledgeId: string): Promise<KnowledgeDto> {
    const knowledge = await this.findOrThrow(knowledgeId);
    return toDto(knowledge);
  }

  async update(
    knowledgeId: string,
    request: UpdateKnowledgeRequest,
  ): Promise<KnowledgeDto> {
    await this.findOrThrow(knowledgeId);

    const errors = validateUpdateKnowledge(request);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" "));
    }

    const knowledge = await this.repository.update(knowledgeId, {
      ...(request.title !== undefined ? { title: request.title.trim() } : {}),
      ...(request.content !== undefined
        ? { content: request.content.trim() }
        : {}),
      ...(request.category !== undefined
        ? { category: request.category?.trim() || null }
        : {}),
    });
    return toDto(knowledge);
  }

  async delete(knowledgeId: string): Promise<void> {
    await this.findOrThrow(knowledgeId);
    await this.repository.delete(knowledgeId);
  }

  private async findOrThrow(knowledgeId: string): Promise<Knowledge> {
    const knowledge = await this.repository.findById(knowledgeId);
    if (!knowledge) {
      throw new NotFoundException(`지식을 찾을 수 없습니다: ${knowledgeId}`);
    }
    return knowledge;
  }
}
