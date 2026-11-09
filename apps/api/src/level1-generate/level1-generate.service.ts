import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { GeminiOneShotError, GeminiOneShotGenerator } from "./gemini-one-shot.client";
import { buildOneShotPrompt, type OneShotAssetRole, type OneShotPromptAsset } from "./one-shot-prompt";

export interface Level1GenerationDto {
  id: string;
  productId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  provider: string;
  model: string;
  promptText: string;
  referenceAssetIds: string[];
  outputObjectKey: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const OUTPUT_MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * LEVEL 1 원샷 상세페이지 생성 (T1-189).
 *
 * 기존 다단계 파이프라인(Product Profile → Design Profile → Composition →
 * Renderer)을 재사용하지 않는다. Level1의 제품 입력/asset 저장 기반
 * (level1_products·level1_assets, T1-188)은 Prisma로 직접 읽기만 하고,
 * 그 테이블·모듈 파일 자체는 수정하지 않는다(동시 작업 충돌 회피,
 * `docs/PROJECT_MEMORY.md` M-28).
 */
@Injectable()
export class Level1GenerateService {
  private readonly logger = new Logger(Level1GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private createGenerator(): GeminiOneShotGenerator {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "GEMINI_API_KEY가 설정되어 있지 않습니다. apps/api/.env를 확인하세요.",
      );
    }
    return new GeminiOneShotGenerator({ apiKey, model: process.env.GEMINI_IMAGE_MODEL });
  }

  async generate(productId: string): Promise<Level1GenerationDto> {
    const product = await this.prisma.level1Product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`제품을 찾을 수 없습니다: ${productId}`);
    }

    const assets = await this.prisma.level1Asset.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
    });
    if (assets.length === 0) {
      throw new BadRequestException(
        "업로드된 사진이 없습니다. 먼저 제품 사진을 1장 이상 업로드하세요.",
      );
    }

    // 실제 제품 사진을 최우선 reference로 — 역할별로 정렬해 프롬프트/입력 순서에 반영한다.
    const rolePriority: Record<OneShotAssetRole, number> = {
      ACTUAL_PRODUCT: 0,
      UNKNOWN: 1,
      LIFESTYLE: 2,
      PACKAGING: 3,
      LABEL: 4,
      SPEC: 5,
      MANUAL: 6,
      BARCODE: 7,
    };
    const ordered = [...assets].sort(
      (a, b) => rolePriority[a.role as OneShotAssetRole] - rolePriority[b.role as OneShotAssetRole],
    );

    const images = await Promise.all(
      ordered.map(async (asset) => ({
        base64: (await this.storage.getObject(asset.objectKey)).toString("base64"),
        mimeType: asset.mimeType,
      })),
    );
    const promptAssets: OneShotPromptAsset[] = ordered.map((asset, index) => ({
      role: asset.role as OneShotAssetRole,
      index,
    }));
    const promptText = buildOneShotPrompt(promptAssets);
    const referenceAssetIds = ordered.map((asset) => asset.id);

    const generator = this.createGenerator();

    try {
      const result = await generator.generate(promptText, images);
      const extension = OUTPUT_MIME_EXTENSION[result.mimeType] ?? "png";
      const outputKey = `level1-generate/${productId}/${randomUUID()}.${extension}`;
      await this.storage.putObject(
        outputKey,
        Buffer.from(result.imageBase64, "base64"),
        result.mimeType,
      );

      const record = await this.prisma.level1Generation.create({
        data: {
          productId,
          status: "SUCCEEDED",
          provider: "gemini",
          model: result.model,
          promptText,
          referenceAssetIds,
          outputObjectKey: outputKey,
          outputMimeType: result.mimeType,
        },
      });
      return this.toDto(record);
    } catch (error) {
      const message =
        error instanceof GeminiOneShotError
          ? error.message
          : error instanceof Error
            ? error.message
            : "알 수 없는 오류";
      this.logger.error(`LEVEL1 원샷 생성 실패 (product ${productId}): ${message}`);
      const record = await this.prisma.level1Generation.create({
        data: {
          productId,
          status: "FAILED",
          provider: "gemini",
          model: generator.model,
          promptText,
          referenceAssetIds,
          errorMessage: message,
        },
      });
      return this.toDto(record);
    }
  }

  async listGenerations(productId: string): Promise<Level1GenerationDto[]> {
    const generations = await this.prisma.level1Generation.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });
    return generations.map((generation) => this.toDto(generation));
  }

  async getGenerationFile(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const generation = await this.prisma.level1Generation.findUnique({ where: { id } });
    if (!generation || !generation.outputObjectKey || !generation.outputMimeType) {
      throw new NotFoundException(`생성 결과 파일을 찾을 수 없습니다: ${id}`);
    }
    const buffer = await this.storage.getObject(generation.outputObjectKey);
    return { buffer, mimeType: generation.outputMimeType };
  }

  private toDto(generation: {
    id: string;
    productId: string;
    status: string;
    provider: string;
    model: string;
    promptText: string;
    referenceAssetIds: string[];
    outputObjectKey: string | null;
    outputMimeType: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Level1GenerationDto {
    return {
      id: generation.id,
      productId: generation.productId,
      status: generation.status as Level1GenerationDto["status"],
      provider: generation.provider,
      model: generation.model,
      promptText: generation.promptText,
      referenceAssetIds: generation.referenceAssetIds,
      outputObjectKey: generation.outputObjectKey,
      outputMimeType: generation.outputMimeType,
      errorMessage: generation.errorMessage,
      createdAt: generation.createdAt.toISOString(),
      updatedAt: generation.updatedAt.toISOString(),
    };
  }
}
