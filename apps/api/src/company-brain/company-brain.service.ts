import { BadRequestException, Injectable } from "@nestjs/common";
import { PRODUCT_CONTENT_SOP } from "@acos/core";
import type { SopDefinition } from "@acos/core";
import { MEMORY_SCOPES } from "@acos/shared";
import type {
  CompanyBrainQueryRequest,
  CompanyBrainQueryResponse,
  DecisionDto,
  KnowledgeDto,
  MemoryDto,
  SopSummaryDto,
} from "@acos/shared";
import type { Decision, Knowledge, Memory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** Company Brain에 등록된 SOP 정의 목록 (선언은 코드에 있다 — TASK-0305) */
const SOP_DEFINITIONS: SopDefinition[] = [PRODUCT_CONTENT_SOP];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function memoryToDto(record: Memory): MemoryDto {
  return {
    id: record.id,
    scope: record.scope,
    scopeId: record.scopeId,
    key: record.key,
    value: record.value,
    description: record.description,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function knowledgeToDto(record: Knowledge): KnowledgeDto {
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    category: record.category,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function decisionToDto(record: Decision): DecisionDto {
  return {
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    description: record.description,
    reason: record.reason,
    decisionType: record.decisionType,
    author: record.author,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function sopToDto(definition: SopDefinition): SopSummaryDto {
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    steps: definition.steps.map((step) => ({ key: step.key, name: step.name })),
  };
}

/**
 * Company Brain Query Service (TASK-0403).
 *
 * AI가 Company Brain을 한 번에 조회하는 진입점 — CTO 지시 순서
 * **Memory → Knowledge → Decision → SOP** 로 각 저장소를 검색해
 * 섹션 배열로 반환한다. 읽기 전용이며, 각 도메인의 소유권은
 * 해당 모듈에 남는다 (Query는 소비만 한다).
 */
@Injectable()
export class CompanyBrainService {
  constructor(private readonly prisma: PrismaService) {}

  async query(
    request: CompanyBrainQueryRequest,
  ): Promise<CompanyBrainQueryResponse> {
    const query = typeof request.query === "string" ? request.query.trim() : "";
    if (query.length === 0) {
      throw new BadRequestException("query은(는) 비어 있을 수 없습니다.");
    }
    if (
      request.scope !== undefined &&
      !(MEMORY_SCOPES as readonly string[]).includes(request.scope)
    ) {
      throw new BadRequestException(
        `scope는 다음 중 하나여야 합니다: ${MEMORY_SCOPES.join(", ")}`,
      );
    }
    const limit = this.resolveLimit(request.limit);
    const scopeId = request.scopeId?.trim() || null;

    // 조회 순서 (CTO 지시): Memory → Knowledge → Decision → SOP
    const memories = await this.queryMemories(
      query,
      limit,
      request.scope,
      scopeId,
    );
    const knowledge = await this.queryKnowledge(query, limit);
    const decisions = await this.queryDecisions(
      query,
      limit,
      request.scope === "PROJECT" ? scopeId : null,
    );
    const sops = this.querySops(query, limit);

    return {
      query,
      results: [
        { source: "MEMORY", items: memories },
        { source: "KNOWLEDGE", items: knowledge },
        { source: "DECISION", items: decisions },
        { source: "SOP", items: sops },
      ],
    };
  }

  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(
        `limit는 1~${MAX_LIMIT} 사이의 정수여야 합니다.`,
      );
    }
    return limit;
  }

  /** Memory: key/description 부분 일치 (+scope/scopeId 필터) */
  private async queryMemories(
    query: string,
    limit: number,
    scope: CompanyBrainQueryRequest["scope"],
    scopeId: string | null,
  ): Promise<MemoryDto[]> {
    const records = await this.prisma.memory.findMany({
      where: {
        ...(scope !== undefined ? { scope } : {}),
        ...(scopeId !== null ? { scopeId } : {}),
        OR: [
          { key: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return records.map(memoryToDto);
  }

  /** Knowledge: title/content 부분 일치 (회사 전역) */
  private async queryKnowledge(
    query: string,
    limit: number,
  ): Promise<KnowledgeDto[]> {
    const records = await this.prisma.knowledge.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return records.map(knowledgeToDto);
  }

  /** Decision: title/description/reason 부분 일치 (+PROJECT scopeId 필터) */
  private async queryDecisions(
    query: string,
    limit: number,
    projectId: string | null,
  ): Promise<DecisionDto[]> {
    const records = await this.prisma.decision.findMany({
      where: {
        ...(projectId !== null ? { projectId } : {}),
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { reason: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return records.map(decisionToDto);
  }

  /** SOP: 코드에 선언된 정의의 key/name/description/단계명 부분 일치 */
  private querySops(query: string, limit: number): SopSummaryDto[] {
    const lowered = query.toLowerCase();
    return SOP_DEFINITIONS.filter((definition) => {
      const haystack = [
        definition.key,
        definition.name,
        definition.description,
        ...definition.steps.flatMap((step) => [step.key, step.name]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(lowered);
    })
      .slice(0, limit)
      .map(sopToDto);
  }
}
