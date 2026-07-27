import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { AnalysisImageInput, AnalysisProvider } from "@acos/core";
import { AnalysisExecutionService } from "@acos/core";
import type { AnalysisResultDto, ProductAnalysis } from "@acos/shared";
import type { AnalysisResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { ANALYSIS_PROVIDER } from "./analysis.constants";
import { PrismaAnalysisRunStore } from "./prisma-analysis-run.store";

function toDto(record: AnalysisResult, includeRaw: boolean): AnalysisResultDto {
  return {
    id: record.id,
    productId: record.productId,
    provider: record.provider,
    status: record.status,
    result: record.result as ProductAnalysis | null,
    ...(includeRaw ? { rawJson: record.rawJson } : {}),
    error: record.error,
    attempts: record.attempts,
    applied: record.applied,
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly execution: AnalysisExecutionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    store: PrismaAnalysisRunStore,
    @Inject(ANALYSIS_PROVIDER) provider: AnalysisProvider,
  ) {
    this.execution = new AnalysisExecutionService(provider, store, {
      maxAttempts: Math.max(1, Number(process.env.ANALYSIS_MAX_ATTEMPTS ?? 3)),
      onAttemptFailed: (attempt, error) =>
        this.logger.warn(`Analysis attempt ${attempt} failed: ${error}`),
    });
  }

  /**
   * 상품 분석 실행 — 호출마다 새 실행 레코드가 쌓인다 (이력 보존, 재실행).
   * apply=true면 SUCCESS 결과를 상품 name/description에 반영한다.
   */
  async runAnalysis(productId: string, apply: boolean): Promise<AnalysisResultDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
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
    if (!product) {
      throw new NotFoundException(`상품을 찾을 수 없습니다: ${productId}`);
    }

    const images: AnalysisImageInput[] = product.images.map((image) => ({
      id: image.id,
      mimeType: image.mimeType,
      getBytes: () => this.storage.getObject(image.key),
    }));
    const ocrTexts = product.images
      .map((image) => image.ocrResults[0]?.extractedText)
      .filter((text): text is string => Boolean(text));

    const run = await this.execution.execute({
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
      },
      images,
      ocrTexts,
    });

    if (apply && run.status === "SUCCESS" && run.result) {
      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: productId },
          data: {
            name: run.result.name,
            description: run.result.description,
          },
        }),
        this.prisma.analysisResult.update({
          where: { id: run.id },
          data: { applied: true },
        }),
      ]);
    }

    const record = await this.prisma.analysisResult.findUniqueOrThrow({
      where: { id: run.id },
    });
    return toDto(record, true);
  }

  /** 가장 최근 분석 결과 */
  async getLatestByProductId(
    productId: string,
    includeRaw: boolean,
  ): Promise<AnalysisResultDto> {
    const record = await this.prisma.analysisResult.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });
    if (!record) {
      throw new NotFoundException(
        `분석 결과가 없습니다. POST /products/${productId}/analysis 로 실행해 주세요.`,
      );
    }
    return toDto(record, includeRaw);
  }

  /** 상품의 전체 분석 이력 (최신순) */
  async getHistoryByProductId(productId: string): Promise<AnalysisResultDto[]> {
    const records = await this.prisma.analysisResult.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => toDto(record, false));
  }
}
