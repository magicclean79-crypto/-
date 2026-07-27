import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { evaluateReadyValidation } from "@acos/core";
import type {
  CompanyBrainQueryResponse,
  CompanyBrainSource,
  DecisionDto,
  KnowledgeDto,
  MemoryDto,
  OcrSummary,
  ReadyValidationRequest,
  ReadyValidationResultDto,
  SopSummaryDto,
} from "@acos/shared";
import type { ProductObject } from "@prisma/client";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { PrismaService } from "../prisma/prisma.service";

function sectionItems<T>(
  response: CompanyBrainQueryResponse,
  source: CompanyBrainSource,
): T[] {
  const section = response.results.find((item) => item.source === source);
  return (section?.items ?? []) as T[];
}

/**
 * READY Validation Engine 서비스 (TASK-0404).
 *
 * CTO 지시대로 **CompanyBrainService를 사용해** Knowledge/Memory/Decision/SOP를
 * 읽고, 판정 로직(@acos/core evaluateReadyValidation)에 전달해
 * READY 전환 가능 여부를 PASS/WARNING/FAIL 3단계로 판단한다.
 * 검증은 판단만 한다 — 실제 전이는 기존 PATCH …/status가 담당 (검증 결과 미강제).
 */
@Injectable()
export class ReadyValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyBrain: CompanyBrainService,
  ) {}

  async validate(
    projectId: string,
    request: ReadyValidationRequest,
  ): Promise<ReadyValidationResultDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }

    const productObject = await this.resolveProductObject(
      projectId,
      request.productObjectVersion,
    );

    // Company Brain 읽기 (조회 순서와 무관하게 목적별 3회 조회)
    const bannedWords = await this.readBannedWords();
    const { relatedRules, relatedDecisions } = await this.readRelatedContext(
      projectId,
      productObject.title,
    );
    const hasStandardSop = await this.readStandardSop();

    const ocrSummary = productObject.ocrSummary as OcrSummary | null;
    const { status, checks } = evaluateReadyValidation({
      productObject: {
        status: productObject.status,
        title: productObject.title,
        brand: productObject.brand,
        category: productObject.category,
        ocrText: ocrSummary?.combinedText ?? null,
        ocrSummary: productObject.ocrSummary,
        visionSummary: productObject.visionSummary,
      },
      bannedWords,
      relatedRules,
      relatedDecisions,
      hasStandardSop,
    });

    return {
      projectId,
      productObjectId: productObject.id,
      productObjectVersion: productObject.version,
      status,
      checks,
      validatedAt: new Date().toISOString(),
    };
  }

  /** Memory(GLOBAL, key=banned-words)에서 금지어 목록을 읽는다 — 미설정이면 null */
  private async readBannedWords(): Promise<string[] | null> {
    const response = await this.companyBrain.query({
      query: "banned-words",
      scope: "GLOBAL",
    });
    const memory = sectionItems<MemoryDto>(response, "MEMORY").find(
      (item) => item.key === "banned-words",
    );
    if (!memory) return null;
    const value = memory.value;
    if (
      Array.isArray(value) &&
      value.every((word) => typeof word === "string")
    ) {
      return value as string[];
    }
    return null;
  }

  /** 제목으로 Knowledge(RULE/LEGAL)·프로젝트 Decision을 검색한다 */
  private async readRelatedContext(
    projectId: string,
    title: string,
  ): Promise<{
    relatedRules: { title: string; category: string | null }[];
    relatedDecisions: { title: string }[];
  }> {
    if (title.trim().length === 0) {
      return { relatedRules: [], relatedDecisions: [] };
    }
    const response = await this.companyBrain.query({
      query: title,
      scope: "PROJECT",
      scopeId: projectId,
    });
    const relatedRules = sectionItems<KnowledgeDto>(response, "KNOWLEDGE")
      .filter((item) => item.category === "RULE" || item.category === "LEGAL")
      .map((item) => ({ title: item.title, category: item.category }));
    const relatedDecisions = sectionItems<DecisionDto>(
      response,
      "DECISION",
    ).map((item) => ({ title: item.title }));
    return { relatedRules, relatedDecisions };
  }

  /** 상품 콘텐츠 표준 절차(product-content) 정의 존재 여부 */
  private async readStandardSop(): Promise<boolean> {
    const response = await this.companyBrain.query({
      query: "product-content",
    });
    return sectionItems<SopSummaryDto>(response, "SOP").some(
      (sop) => sop.key === "product-content",
    );
  }

  private async resolveProductObject(
    projectId: string,
    version: number | undefined,
  ): Promise<ProductObject> {
    if (version !== undefined) {
      if (!Number.isInteger(version) || version < 1) {
        throw new BadRequestException(
          "productObjectVersion은 1 이상의 정수여야 합니다.",
        );
      }
      const record = await this.prisma.productObject.findFirst({
        where: { projectId, version },
      });
      if (!record) {
        throw new NotFoundException(
          `Product Object v${version}이 없습니다: ${projectId}`,
        );
      }
      return record;
    }

    const latest = await this.prisma.productObject.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    if (!latest) {
      throw new NotFoundException(
        `Product Object가 없습니다. POST /projects/${projectId}/product-object 로 조립해 주세요.`,
      );
    }
    return latest;
  }
}
