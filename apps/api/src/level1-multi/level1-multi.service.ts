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
import { GeminiAnalysisError, GeminiAnalysisGenerator } from "./gemini-analysis.client";
import { GeminiPageImageError, GeminiPageImageGenerator } from "./gemini-page-image.client";
import { buildPageImagePrompt } from "./multi-page-prompt";
import {
  EMPTY_VERIFIED_PRODUCT_FACTS,
  ensureMandatoryPagePlan,
  type ClassifiedAssetRole,
  type PagePlanItem,
  type VerifiedProductFacts,
} from "./multi-page-types";

export interface Level1DetailPageDto {
  id: string;
  pageIndex: number;
  pageRole: string;
  title: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  provider: string | null;
  model: string | null;
  referenceAssetIds: string[];
  outputObjectKey: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * verifiedProductFacts의 근거(provenance, T1-195) — "이 정보가 어디서
 * 나왔는가"를 최종 결과 화면에서 바로 확인할 수 있게 한다. 값을
 * 새로 만들지 않고, 이미 이 생성 레코드에 저장된 사실만 조립한다.
 */
export interface ProductFactsProvenanceDto {
  method: "vision-analysis";
  provider: string | null;
  model: string | null;
  analyzedAssetIds: string[];
  actualProductAssetIds: string[];
}

export interface Level1MultiGenerationDto {
  id: string;
  productId: string;
  status: "PENDING" | "ANALYZING" | "GENERATING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  analysisProvider: string | null;
  analysisModel: string | null;
  verifiedProductFacts: VerifiedProductFacts | null;
  productFactsProvenance: ProductFactsProvenanceDto | null;
  errorMessage: string | null;
  pages: Level1DetailPageDto[];
  createdAt: string;
  updatedAt: string;
}

const OUTPUT_MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** 원본 사진을 형태 reference로 쓸 수 없는 역할 (요청 사양 7) */
const NON_SHAPE_REFERENCE_ROLES = new Set<ClassifiedAssetRole>([
  "PACKAGING",
  "LABEL",
  "SPEC",
  "BARCODE",
  "MANUAL",
]);

/**
 * LEVEL 2 다중 상세페이지 생성 (T1-191).
 *
 * T1-189의 단일 이미지 원샷 엔진 위에서, ① 분석 호출 1회로 검증된 제품
 * 정보 + 페이지 구성을 정하고 ② 페이지마다 이미지 생성 호출을 1회씩
 * 반복한다(최소 호출 = 1 + 페이지 수). level1_products/level1_assets
 * (T1-188)·level1_generations(T1-189, 그 서비스/컨트롤러 파일)는 전혀
 * 수정하지 않는다 — Prisma로 필요한 테이블만 직접 읽는다.
 */
@Injectable()
export class Level1MultiService {
  private readonly logger = new Logger(Level1MultiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private requireApiKey(): string {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "GEMINI_API_KEY가 설정되어 있지 않습니다. apps/api/.env를 확인하세요.",
      );
    }
    return apiKey;
  }

  /** 생성을 시작하고 즉시 반환한다(비동기) — 진행 상황은 getGeneration()으로 폴링한다. */
  async startGeneration(productId: string): Promise<Level1MultiGenerationDto> {
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

    // GEMINI_API_KEY 부재는 실행을 시작하기 전에 바로 알린다(과금 호출 전 실패).
    this.requireApiKey();

    const generation = await this.prisma.level1MultiGeneration.create({
      data: { productId, status: "ANALYZING" },
      include: { pages: true },
    });

    // 무인 실행 — 응답을 기다리지 않고 백그라운드에서 진행한다(Bridge의
    // /run 즉시 202 + 폴링 패턴과 같은 이유, `bridge/README.md` §3-2).
    void this.runPipeline(generation.id, productId, assets).catch((error) => {
      this.logger.error(
        `LEVEL2 다중 생성 파이프라인이 예기치 않게 중단됨 (generation ${generation.id}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return this.toDto(generation);
  }

  private async runPipeline(
    generationId: string,
    productId: string,
    assets: { id: string; objectKey: string; mimeType: string; role: string }[],
  ): Promise<void> {
    const apiKey = this.requireApiKey();

    let analysis;
    try {
      const images = await Promise.all(
        assets.map(async (asset) => ({
          base64: (await this.storage.getObject(asset.objectKey)).toString("base64"),
          mimeType: asset.mimeType,
        })),
      );
      const analyzer = new GeminiAnalysisGenerator({ apiKey });
      analysis = await analyzer.analyze(images);

      const { pagePlan: ensuredPagePlan, injectedRoles } = ensureMandatoryPagePlan(
        analysis.result.pagePlan,
      );
      if (injectedRoles.length > 0) {
        this.logger.warn(
          `LEVEL2 분석 결과에 필수 역할이 빠져 있어 보수적 기본 페이지를 추가함 (generation ${generationId}): ${injectedRoles.join(", ")}`,
        );
      }
      analysis.result.pagePlan = ensuredPagePlan;

      await this.prisma.level1MultiGeneration.update({
        where: { id: generationId },
        data: {
          status: "GENERATING",
          analysisProvider: "gemini",
          analysisModel: analysis.model,
          analysisRawText: analysis.rawText,
          analysisAssetIds: assets.map((asset) => asset.id),
          verifiedProductFacts: analysis.result.verifiedProductFacts as unknown as object,
        },
      });
    } catch (error) {
      const message =
        error instanceof GeminiAnalysisError
          ? error.message
          : error instanceof Error
            ? error.message
            : "알 수 없는 오류";
      this.logger.error(`LEVEL2 분석 호출 실패 (product ${productId}): ${message}`);
      await this.prisma.level1MultiGeneration.update({
        where: { id: generationId },
        data: {
          status: "FAILED",
          analysisProvider: "gemini",
          errorMessage: message,
        },
      });
      return;
    }

    // 실제 제품 사진으로 분류된 asset만 형태 reference로 쓴다 — 사람이 미리
    // 역할을 지정해 둔 asset(PATCH /level1/assets/:id/role)이 있으면 AI
    // 분류보다 우선한다(확인된 사실이 AI 추정보다 우선, MASTER_GUIDE 철학 2).
    const roleByIndex = new Map(analysis.result.assetRoles.map((r) => [r.assetIndex, r.role]));
    const actualProductAssets = assets.filter((asset, index) => {
      if (asset.role && asset.role !== "UNKNOWN") {
        return asset.role === "ACTUAL_PRODUCT";
      }
      const classified = roleByIndex.get(index) ?? "UNKNOWN";
      return classified === "ACTUAL_PRODUCT" && !NON_SHAPE_REFERENCE_ROLES.has(classified);
    });

    if (actualProductAssets.length === 0) {
      const message =
        "실제 제품 사진으로 분류된 이미지가 없어 상세페이지를 생성할 수 없습니다. " +
        "포장/라벨/사양표가 아닌, 제품이 직접 보이는 사진을 1장 이상 업로드하세요.";
      this.logger.warn(`LEVEL2 실제 제품 사진 없음 (product ${productId})`);
      await this.prisma.level1MultiGeneration.update({
        where: { id: generationId },
        data: {
          status: "FAILED",
          errorMessage: message,
          actualProductAssetIds: [],
        },
      });
      return;
    }

    const actualProductAssetIds = actualProductAssets.map((a) => a.id);
    await this.prisma.level1MultiGeneration.update({
      where: { id: generationId },
      data: { actualProductAssetIds },
    });

    const referenceImages = await Promise.all(
      actualProductAssets.map(async (asset) => ({
        base64: (await this.storage.getObject(asset.objectKey)).toString("base64"),
        mimeType: asset.mimeType,
      })),
    );

    let succeededCount = 0;
    let failedCount = 0;
    const totalPages = analysis.result.pagePlan.length;

    for (const page of analysis.result.pagePlan) {
      const succeeded = await this.generateOnePage({
        generationId,
        productId,
        page,
        totalPages,
        apiKey,
        referenceImages,
        referenceAssetIds: actualProductAssetIds,
      });
      if (succeeded) succeededCount += 1;
      else failedCount += 1;
    }

    const finalStatus =
      succeededCount === 0 ? "FAILED" : failedCount === 0 ? "SUCCEEDED" : "PARTIAL";
    await this.prisma.level1MultiGeneration.update({
      where: { id: generationId },
      data: {
        status: finalStatus,
        errorMessage:
          finalStatus === "FAILED"
            ? "모든 페이지 이미지 생성에 실패했습니다. 각 페이지의 오류 메시지를 확인하세요."
            : null,
      },
    });
  }

  private async generateOnePage(args: {
    generationId: string;
    productId: string;
    page: PagePlanItem;
    totalPages: number;
    apiKey: string;
    referenceImages: { base64: string; mimeType: string }[];
    referenceAssetIds: string[];
  }): Promise<boolean> {
    const { generationId, page, totalPages, apiKey, referenceImages, referenceAssetIds } = args;
    const promptText = buildPageImagePrompt(page, totalPages);
    const generator = new GeminiPageImageGenerator({ apiKey });

    try {
      const result = await generator.generate(promptText, referenceImages);
      const extension = OUTPUT_MIME_EXTENSION[result.mimeType] ?? "png";
      const outputKey = `level1-multi/${generationId}/${page.pageIndex}-${randomUUID()}.${extension}`;
      await this.storage.putObject(outputKey, Buffer.from(result.imageBase64, "base64"), result.mimeType);

      await this.prisma.level1DetailPage.create({
        data: {
          generationId,
          pageIndex: page.pageIndex,
          pageRole: page.pageRole,
          title: page.title,
          status: "SUCCEEDED",
          provider: "gemini",
          model: result.model,
          promptText,
          referenceAssetIds,
          outputObjectKey: outputKey,
          outputMimeType: result.mimeType,
        },
      });
      return true;
    } catch (error) {
      const message =
        error instanceof GeminiPageImageError
          ? error.message
          : error instanceof Error
            ? error.message
            : "알 수 없는 오류";
      this.logger.error(
        `LEVEL2 페이지 이미지 생성 실패 (generation ${generationId}, page ${page.pageIndex}): ${message}`,
      );
      await this.prisma.level1DetailPage.create({
        data: {
          generationId,
          pageIndex: page.pageIndex,
          pageRole: page.pageRole,
          title: page.title,
          status: "FAILED",
          provider: "gemini",
          promptText,
          referenceAssetIds,
          errorMessage: message,
        },
      });
      return false;
    }
  }

  async getGeneration(id: string): Promise<Level1MultiGenerationDto> {
    const generation = await this.prisma.level1MultiGeneration.findUnique({
      where: { id },
      include: { pages: { orderBy: { pageIndex: "asc" } } },
    });
    if (!generation) {
      throw new NotFoundException(`생성 결과를 찾을 수 없습니다: ${id}`);
    }
    return this.toDto(generation);
  }

  async getPageFile(pageId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const page = await this.prisma.level1DetailPage.findUnique({ where: { id: pageId } });
    if (!page || !page.outputObjectKey || !page.outputMimeType) {
      throw new NotFoundException(`페이지 이미지를 찾을 수 없습니다: ${pageId}`);
    }
    const buffer = await this.storage.getObject(page.outputObjectKey);
    return { buffer, mimeType: page.outputMimeType };
  }

  private toDto(generation: {
    id: string;
    productId: string;
    status: string;
    analysisProvider: string | null;
    analysisModel: string | null;
    verifiedProductFacts: unknown;
    analysisAssetIds: string[];
    actualProductAssetIds: string[];
    errorMessage: string | null;
    pages?: {
      id: string;
      pageIndex: number;
      pageRole: string;
      title: string | null;
      status: string;
      provider: string | null;
      model: string | null;
      referenceAssetIds: string[];
      outputObjectKey: string | null;
      outputMimeType: string | null;
      errorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[];
    createdAt: Date;
    updatedAt: Date;
  }): Level1MultiGenerationDto {
    return {
      id: generation.id,
      productId: generation.productId,
      status: generation.status as Level1MultiGenerationDto["status"],
      analysisProvider: generation.analysisProvider,
      analysisModel: generation.analysisModel,
      verifiedProductFacts: generation.verifiedProductFacts
        ? (generation.verifiedProductFacts as VerifiedProductFacts)
        : generation.status === "PENDING" || generation.status === "ANALYZING"
          ? null
          : { ...EMPTY_VERIFIED_PRODUCT_FACTS },
      productFactsProvenance: generation.verifiedProductFacts
        ? {
            method: "vision-analysis",
            provider: generation.analysisProvider,
            model: generation.analysisModel,
            analyzedAssetIds: generation.analysisAssetIds,
            actualProductAssetIds: generation.actualProductAssetIds,
          }
        : null,
      errorMessage: generation.errorMessage,
      pages: (generation.pages ?? []).map((page) => ({
        id: page.id,
        pageIndex: page.pageIndex,
        pageRole: page.pageRole,
        title: page.title,
        status: page.status as Level1DetailPageDto["status"],
        provider: page.provider,
        model: page.model,
        referenceAssetIds: page.referenceAssetIds,
        outputObjectKey: page.outputObjectKey,
        outputMimeType: page.outputMimeType,
        errorMessage: page.errorMessage,
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
      })),
      createdAt: generation.createdAt.toISOString(),
      updatedAt: generation.updatedAt.toISOString(),
    };
  }
}
