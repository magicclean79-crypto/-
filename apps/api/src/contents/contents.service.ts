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
  ContentStatusHistoryDto,
  GenerateContentRequest,
  OcrSummary,
  VisionSummary,
} from "@acos/shared";
import type { Content, ProductObject } from "@prisma/client";
import { ContentGovernanceService } from "../content-governance/content-governance.service";
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
    // 발행 게이트 (TASK-2501) — 판정은 이 계층 하나에서만 한다
    private readonly governance: ContentGovernanceService,
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
   * 발행 파이프라인 상태 전이 (TASK-0703 · 거버넌스 게이트 TASK-2501).
   * DRAFT → REVIEW → PUBLISHED → ARCHIVED (전이 규칙은 @acos/core
   * canTransition — REVIEW→DRAFT 되돌리기·단계별 ARCHIVED 포함).
   *
   * **PUBLISHED 전이는 거버넌스 판정을 통과해야 한다** (TASK-2501).
   * 그 전까지 발행 조건은 "REVIEW 상태이며 제목과 본문이 비어 있지 않다"
   * 뿐이었다 — 금지어가 든 본문도, 필수 고지가 빠진 본문도 그냥 나갔다.
   * 상품(READY 판정)만 검사하고 실제로 나가는 콘텐츠를 검사하지 않는 것은
   * **재료를 검사하고 완성품은 안 보는 것**과 같다.
   *
   * 판정은 **막든 통과하든 기록한다** — 무엇이 막았고 언제 풀렸는지가 없으면
   * "왜 이렇게 늦게 발행됐지"에 아무도 답할 수 없다.
   * 다른 전이(REVIEW·ARCHIVED 등)는 막지 않는다 — 검토를 요청하는 것과
   * 세상에 내보내는 것은 다르다.
   */
  async updateStatus(
    projectId: string,
    contentId: string,
    status: string,
    actor: string | null = null,
  ): Promise<ContentDto> {
    if (!(CONTENT_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(
        `status는 다음 중 하나여야 합니다: ${CONTENT_STATUSES.join(", ")}`,
      );
    }
    const target = status as ContentStatus;

    const record = await this.prisma.content.findFirst({
      where: { id: contentId, projectId },
      include: {
        productObject: {
          select: { version: true, status: true, category: true },
        },
      },
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
            : "") +
          // 되살린 것은 게이트를 다시 거쳐야 한다 (CTO 결정 2601-①)
          (record.status === "ARCHIVED" && target === "PUBLISHED"
            ? " 보관된 콘텐츠는 DRAFT로 되살린 뒤 REVIEW를 거쳐 다시 발행하세요 — 그래야 거버넌스 판정이 다시 돕니다."
            : ""),
      );
    }
    if (target === "PUBLISHED" && !isPublishable(record)) {
      throw new BadRequestException(
        "발행 조건을 충족하지 않습니다 — REVIEW 상태이며 제목과 본문이 있어야 합니다.",
      );
    }

    // 거버넌스 게이트 (TASK-2501) — 발행에만 적용한다.
    // 판정은 **읽어 둔 이 레코드로** 한다: 다시 읽으면 판정한 내용과
    // 발행되는 내용이 다를 수 있다.
    if (target === "PUBLISHED") {
      const verdict = await this.governance.judge({
        id: record.id,
        projectId: record.projectId,
        status: record.status,
        title: record.title,
        body: record.body,
        productObject: record.productObject
          ? {
              version: record.productObject.version,
              status: record.productObject.status,
              category: record.productObject.category,
            }
          : null,
      });

      // 통과든 차단이든 남긴다 — 막힌 기록이 없으면 지연을 설명할 수 없다
      await this.governance.record(record.id, verdict, {
        published: verdict.publishable,
        actor,
      });

      if (!verdict.publishable) {
        throw new BadRequestException(
          "발행 거버넌스 판정을 통과하지 못했습니다 — " +
            verdict.blockers
              .map((check) => `${check.name}: ${check.messages.join(" ")}`)
              .join(" / "),
        );
      }
    }

    // 전이 + 감사 이력(TASK-0704)을 한 트랜잭션으로 기록한다
    const [updated] = await this.prisma.$transaction([
      this.prisma.content.update({
        where: { id: record.id },
        data: {
          status: target,
          // publishedAt은 최초 발행 시점 보존 (CTO 결정, TASK-0703 승인 ②)
          ...(target === "PUBLISHED" && !record.publishedAt
            ? { publishedAt: new Date() }
            : {}),
        },
        include: { productObject: { select: { version: true } } },
      }),
      this.prisma.contentStatusHistory.create({
        data: {
          contentId: record.id,
          fromStatus: record.status,
          toStatus: target,
          actor, // 수행자 이메일 (TASK-0801 Actor Audit)
        },
      }),
    ]);
    return toDto(updated as ContentWithVersion);
  }

  /** 발행 파이프라인 감사 이력 조회 (TASK-0704) — 최신순 */
  async getStatusHistory(
    projectId: string,
    contentId: string,
  ): Promise<ContentStatusHistoryDto[]> {
    const content = await this.prisma.content.findFirst({
      where: { id: contentId, projectId },
      select: { id: true },
    });
    if (!content) {
      throw new NotFoundException(`콘텐츠를 찾을 수 없습니다: ${contentId}`);
    }
    const records = await this.prisma.contentStatusHistory.findMany({
      where: { contentId },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => ({
      id: record.id,
      contentId: record.contentId,
      fromStatus: record.fromStatus,
      toStatus: record.toStatus,
      actor: record.actor,
      createdAt: record.createdAt.toISOString(),
    }));
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
