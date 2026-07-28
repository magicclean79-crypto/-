import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { extractMarkdownTitle } from "@acos/core";
import type { ContentGenerationContext, PromptEngine } from "@acos/core";
import type {
  ContentDto,
  DecisionDto,
  GenerateContentRequest,
  KnowledgeDto,
  MemoryDto,
  OcrSummary,
  VisionSummary,
} from "@acos/shared";
import type { CompanyBrainQueryResponse, CompanyBrainSource } from "@acos/shared";
import type { Content, ProductObject } from "@prisma/client";
import { CompanyBrainService } from "../company-brain/company-brain.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";

function sectionItems<T>(
  response: CompanyBrainQueryResponse,
  source: CompanyBrainSource,
): T[] {
  const section = response.results.find((item) => item.source === source);
  return (section?.items ?? []) as T[];
}

type ContentWithVersion = Content & {
  productObject: { version: number } | null;
};

function toDto(record: ContentWithVersion): ContentDto {
  return {
    id: record.id,
    projectId: record.projectId,
    productObjectId: record.productObjectId,
    productObjectVersion: record.productObject?.version ?? null,
    title: record.title,
    body: record.body,
    status: record.status,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** 저장 없이 Markdown만 생성할 때의 입력 — Product Object 스냅샷 기반 */
export interface MarkdownGenerationInput {
  project: { id: string; name: string; description: string | null };
  productObject: {
    version: number;
    title: string;
    brand: string | null;
    category: string | null;
    attributes: Record<string, string>;
    ocrText: string | null;
    visionLabels: string[];
  };
}

export interface MarkdownGenerationResult {
  title: string;
  /** 상세페이지 본문 (Markdown) */
  body: string;
  llm: { provider: string; model: string };
}

/**
 * Content Generation Engine (TASK-0502, Sprint 5 — AI Execution).
 *
 * CTO 지시대로 세 가지를 반드시 사용한다:
 * ① READY Product Object (검증 규칙은 TASK-0303과 동일)
 * ② Company Brain (CompanyBrainService — 지식/결정/설정/금지어 컨텍스트)
 * ③ LLM Gateway (LlmService — Provider 교체 구조, 기본 mock)
 * 프롬프트는 Prompt Engine(TASK-0503)의 "content-generation" 템플릿으로
 * 렌더링하고, 생성된 Markdown은 Content로 저장된다.
 *
 * generateMarkdown()은 저장 없는 생성 코어로, 구 Generator 경로의
 * EngineContentGenerator(Wrapper, TASK-0506)도 이 메서드로 통합된다.
 */
@Injectable()
export class ContentGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyBrain: CompanyBrainService,
    private readonly llm: LlmService,
    @Inject(PROMPT_ENGINE) private readonly promptEngine: PromptEngine,
  ) {}

  async generate(
    projectId: string,
    request: GenerateContentRequest,
  ): Promise<ContentDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }

    // ① READY Product Object
    const productObject = await this.resolveReadyProductObject(
      projectId,
      request.productObjectVersion,
    );

    // ②③ Company Brain + Prompt Engine + LLM Gateway (저장 없는 생성 코어)
    const ocrSummary = productObject.ocrSummary as OcrSummary | null;
    const visionSummary = productObject.visionSummary as VisionSummary | null;
    const result = await this.generateMarkdown({
      project: {
        id: projectId,
        name: project.name,
        description: project.description,
      },
      productObject: {
        version: productObject.version,
        title: productObject.title,
        brand: productObject.brand,
        category: productObject.category,
        attributes:
          (productObject.attributes as Record<string, string> | null) ?? {},
        ocrText: ocrSummary?.combinedText ?? null,
        visionLabels: visionSummary?.labels ?? [],
      },
    });

    // 생성 결과를 Content에 저장
    const record = await this.prisma.content.create({
      data: {
        projectId,
        productObjectId: productObject.id,
        title: result.title,
        body: result.body,
      },
      include: { productObject: { select: { version: true } } },
    });
    return toDto(record);
  }

  /**
   * 저장 없는 생성 코어 — Company Brain 조회 + "content-generation" 템플릿
   * 렌더링 + LLM Gateway 호출. generate()와 구 Generator Wrapper
   * (EngineContentGenerator, TASK-0506)가 공용으로 사용한다.
   */
  async generateMarkdown(
    input: MarkdownGenerationInput,
  ): Promise<MarkdownGenerationResult> {
    const companyBrain = await this.readCompanyBrain(
      input.project.id,
      input.productObject.title,
    );

    const context: ContentGenerationContext = {
      project: {
        name: input.project.name,
        description: input.project.description,
      },
      productObject: input.productObject,
      companyBrain,
    };
    const completion = await this.llm.complete(
      { messages: this.promptEngine.render("content-generation", context) },
      { feature: "content-generation" },
    );

    return {
      title: extractMarkdownTitle(
        completion.text,
        `${input.productObject.title} 상세페이지`,
      ),
      body: completion.text,
      llm: { provider: completion.provider, model: completion.model },
    };
  }

  /** Company Brain 읽기 — 제목 검색(PROJECT 스코프) + 금지어(GLOBAL) */
  private async readCompanyBrain(
    projectId: string,
    title: string,
  ): Promise<ContentGenerationContext["companyBrain"]> {
    const empty: ContentGenerationContext["companyBrain"] = {
      knowledge: [],
      decisions: [],
      memories: [],
      bannedWords: null,
    };

    const bannedResponse = await this.companyBrain.query({
      query: "banned-words",
      scope: "GLOBAL",
    });
    const bannedMemory = sectionItems<MemoryDto>(
      bannedResponse,
      "MEMORY",
    ).find((item) => item.key === "banned-words");
    const bannedWords =
      bannedMemory &&
      Array.isArray(bannedMemory.value) &&
      bannedMemory.value.every((word) => typeof word === "string")
        ? (bannedMemory.value as string[])
        : null;

    if (title.trim().length === 0) {
      return { ...empty, bannedWords };
    }

    const response = await this.companyBrain.query({
      query: title,
      scope: "PROJECT",
      scopeId: projectId,
    });
    return {
      knowledge: sectionItems<KnowledgeDto>(response, "KNOWLEDGE").map(
        (item) => ({
          title: item.title,
          content: item.content,
          category: item.category,
        }),
      ),
      decisions: sectionItems<DecisionDto>(response, "DECISION").map(
        (item) => ({ title: item.title, reason: item.reason }),
      ),
      memories: sectionItems<MemoryDto>(response, "MEMORY").map((item) => ({
        key: item.key,
        value: item.value,
        description: item.description,
      })),
      bannedWords,
    };
  }

  /** READY 상태의 Product Object만 허용 — TASK-0303과 동일한 규칙 */
  private async resolveReadyProductObject(
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
      if (record.status !== "READY") {
        throw new BadRequestException(
          `Product Object v${version}은 READY 상태가 아닙니다 (현재: ${record.status}). ` +
            "상태 전이 후 다시 시도해 주세요.",
        );
      }
      return record;
    }

    const latestReady = await this.prisma.productObject.findFirst({
      where: { projectId, status: "READY" },
      orderBy: { version: "desc" },
    });
    if (!latestReady) {
      throw new BadRequestException(
        "READY 상태의 Product Object가 없습니다. " +
          "조립(PATCH …/status READY) 후 콘텐츠를 생성해 주세요.",
      );
    }
    return latestReady;
  }
}
