import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  allowedTransitions,
  canTransition,
  isPublishable,
} from "@acos/core";
import type { ContentGenerator } from "@acos/core";
import { CONTENT_STATUSES } from "@acos/shared";
import type {
  ContentDto,
  ContentStatus,
  GenerateContentRequest,
  OcrSummary,
  VisionSummary,
} from "@acos/shared";
import type { Content, ProductObject } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CONTENT_GENERATOR } from "./contents.constants";

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

@Injectable()
export class ContentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_GENERATOR) private readonly generator: ContentGenerator,
  ) {}

  /**
   * 상세페이지 생성 (TASK-0303 경로).
   * READY 상태의 Product Object에서만 생성한다 —
   * 버전 미지정 시 최신 READY 버전을 사용한다.
   *
   * @deprecated CTO 결정(TASK-0502 승인·TASK-0506 통합 완료): 공식 생성
   * 엔진은 ContentGenerationService다. 이 경로는 유지되지만 내부적으로
   * EngineContentGenerator(Wrapper)를 통해 공식 엔진을 호출한다 —
   * 신규 코드는 POST …/contents/generate(공식 경로)를 사용할 것.
   */
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

    const productObject = await this.resolveProductObject(
      projectId,
      request.productObjectVersion,
    );

    const result = await this.generator.generate({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      productObject: {
        id: productObject.id,
        version: productObject.version,
        title: productObject.title,
        brand: productObject.brand,
        category: productObject.category,
        attributes:
          (productObject.attributes as Record<string, string> | null) ?? {},
        ocrSummary: productObject.ocrSummary as OcrSummary | null,
        visionSummary: productObject.visionSummary as VisionSummary | null,
      },
    });

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

  async list(projectId: string): Promise<ContentDto[]> {
    const records = await this.prisma.content.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { productObject: { select: { version: true } } },
    });
    return records.map(toDto);
  }

  /**
   * 발행 파이프라인 상태 전이 (TASK-0703).
   * DRAFT → REVIEW → PUBLISHED → ARCHIVED (전이 규칙은 @acos/core
   * canTransition — REVIEW→DRAFT 되돌리기·단계별 ARCHIVED 포함).
   * PUBLISHED 전이는 발행 조건(isPublishable: REVIEW + 제목/본문)을 추가로
   * 검증하고 publishedAt을 기록한다.
   */
  async updateStatus(
    projectId: string,
    contentId: string,
    status: string,
  ): Promise<ContentDto> {
    if (!(CONTENT_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(
        `status는 다음 중 하나여야 합니다: ${CONTENT_STATUSES.join(", ")}`,
      );
    }
    const target = status as ContentStatus;

    const record = await this.prisma.content.findFirst({
      where: { id: contentId, projectId },
    });
    if (!record) {
      throw new NotFoundException(`콘텐츠를 찾을 수 없습니다: ${contentId}`);
    }

    if (!canTransition(record.status, target)) {
      const allowed = allowedTransitions(record.status);
      throw new BadRequestException(
        `${record.status}에서 ${target}(으)로 전이할 수 없습니다.` +
          (allowed.length > 0
            ? ` 가능한 전이: ${allowed.join(", ")}`
            : " (ARCHIVED는 종결 상태입니다)"),
      );
    }
    if (target === "PUBLISHED" && !isPublishable(record)) {
      throw new BadRequestException(
        "발행 조건을 충족하지 않습니다 — REVIEW 상태이며 제목과 본문이 있어야 합니다.",
      );
    }

    const updated = await this.prisma.content.update({
      where: { id: record.id },
      data: {
        status: target,
        ...(target === "PUBLISHED" ? { publishedAt: new Date() } : {}),
      },
      include: { productObject: { select: { version: true } } },
    });
    return toDto(updated);
  }

  async getById(projectId: string, contentId: string): Promise<ContentDto> {
    const record = await this.prisma.content.findFirst({
      where: { id: contentId, projectId },
      include: { productObject: { select: { version: true } } },
    });
    if (!record) {
      throw new NotFoundException(`콘텐츠를 찾을 수 없습니다: ${contentId}`);
    }
    return toDto(record);
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
