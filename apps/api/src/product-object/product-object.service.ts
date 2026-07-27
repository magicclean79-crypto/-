import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ProductObjectBuilder } from "@acos/core";
import type { VisionInput, VisionProvider } from "@acos/core";
import type {
  OcrSummary,
  OcrTextSource,
  ProductObjectDto,
  VisionSummary,
} from "@acos/shared";
import { Prisma, type ProductObject } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { VISION_PROVIDER } from "./vision.constants";

function toDto(record: ProductObject): ProductObjectDto {
  return {
    id: record.id,
    projectId: record.projectId,
    version: record.version,
    status: record.status,
    title: record.title,
    brand: record.brand,
    category: record.category,
    attributes: (record.attributes as Record<string, string> | null) ?? {},
    ocrSummary: record.ocrSummary as OcrSummary | null,
    visionSummary: record.visionSummary as VisionSummary | null,
    metadata: record.metadata as Record<string, unknown> | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProductObjectService {
  private readonly logger = new Logger(ProductObjectService.name);
  private readonly visionMaxAttempts = Math.max(
    1,
    Number(process.env.VISION_MAX_ATTEMPTS ?? 3),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(VISION_PROVIDER) private readonly vision: VisionProvider,
  ) {}

  /**
   * 프로젝트의 이미지 OCR 결과(+ Vision mock)를 Builder로 조립해
   * 새 버전의 Product Object를 생성한다. (버전은 프로젝트별 1부터 증가)
   */
  async buildAndCreate(projectId: string): Promise<ProductObjectDto> {
    const project = await this.prisma.product.findUnique({
      where: { id: projectId },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
          include: {
            ocrResults: {
              where: { status: "SUCCESS" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }

    const ocrSources: OcrTextSource[] = project.images
      .map((image) => {
        const ocr = image.ocrResults[0];
        return ocr?.extractedText
          ? {
              imageId: image.id,
              text: ocr.extractedText,
              confidence: ocr.confidence,
            }
          : null;
      })
      .filter((source): source is OcrTextSource => source !== null);

    // VISION_PROVIDER로 선택된 Provider가 visionSummary를 공급한다 (기본: mock).
    // Vision 실패는 조립을 막지 않는다 — 재시도 후에도 실패하면 null로 진행.
    const vision = await this.resolveVisionSummary({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      images: project.images.map((image) => ({
        id: image.id,
        mimeType: image.mimeType,
        getBytes: () => this.storage.getObject(image.key),
      })),
      ocrTexts: ocrSources.map((source) => source.text),
    });

    const draft = new ProductObjectBuilder({
      id: project.id,
      name: project.name,
      description: project.description,
    })
      .withOcrResults(ocrSources)
      .withVisionSummary(vision)
      .withImageCount(project.images.length)
      .build();

    const latest = await this.prisma.productObject.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const record = await this.prisma.productObject.create({
      data: {
        projectId,
        version: (latest?.version ?? 0) + 1,
        title: draft.title,
        brand: draft.brand,
        category: draft.category,
        attributes: draft.attributes as Prisma.InputJsonValue,
        ocrSummary: draft.ocrSummary as unknown as Prisma.InputJsonValue,
        visionSummary: draft.visionSummary as unknown as Prisma.InputJsonValue,
        metadata: draft.metadata as Prisma.InputJsonValue,
      },
    });
    return toDto(record);
  }

  private async resolveVisionSummary(
    input: VisionInput,
  ): Promise<VisionSummary | null> {
    for (let attempt = 1; attempt <= this.visionMaxAttempts; attempt++) {
      try {
        const { summary } = await this.vision.analyze(input);
        return summary;
      } catch (error) {
        this.logger.warn(
          `Vision attempt ${attempt}/${this.visionMaxAttempts} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return null;
  }

  /** 최신 버전 조회 (?version=N 으로 특정 버전 조회) */
  async getByProjectId(
    projectId: string,
    version?: number,
  ): Promise<ProductObjectDto> {
    const record = await this.prisma.productObject.findFirst({
      where: {
        projectId,
        ...(version !== undefined ? { version } : {}),
      },
      orderBy: { version: "desc" },
    });
    if (!record) {
      throw new NotFoundException(
        version !== undefined
          ? `Product Object v${version}이 없습니다: ${projectId}`
          : `Product Object가 없습니다. POST /projects/${projectId}/product-object 로 생성해 주세요.`,
      );
    }
    return toDto(record);
  }

  /** 버전 이력 (최신순) */
  async getHistory(projectId: string): Promise<ProductObjectDto[]> {
    const records = await this.prisma.productObject.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    return records.map(toDto);
  }
}
