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
import { type FieldVerification, verifyFields, type FieldObservation } from "./facts-verification";
import { fallbackSectionDescription, GeminiAnalysisError, GeminiAnalysisGenerator } from "./gemini-analysis.client";
import { GeminiPageImageError, GeminiPageImageGenerator } from "./gemini-page-image.client";
import { Level1AssetOcrService } from "./level1-asset-ocr.service";
import { buildPageImagePrompt } from "./multi-page-prompt";
import {
  EMPTY_VERIFIED_PRODUCT_FACTS,
  ensureMandatoryPagePlan,
  type ClassifiedAssetRole,
  type PagePlanItem,
  type VerifiedProductFacts,
} from "./multi-page-types";
import {
  extractOcrArrayFactCandidates,
  extractOcrFactCandidates,
  OCR_FACT_FIELDS,
  type OcrFactCandidate,
} from "./ocr-facts-extraction";

export interface Level1DetailPageDto {
  id: string;
  pageIndex: number;
  pageRole: string;
  title: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  provider: string | null;
  model: string | null;
  referenceAssetIds: string[];
  /** 이 섹션이 무엇을 보여주는지 사람이 읽는 설명(T1-196) — 화면 텍스트용, 이미지 안에는 글자를 그리지 않는다. */
  sectionDescription: string | null;
  /** sectionDescription의 근거 사진(시각 reference + OCR로 정보가 확인된 사진, T1-196) */
  evidenceAssetIds: string[];
  /** sectionDescription 신뢰도 — AI가 직접 냈는지·전역 Product Facts 충돌 여부로 코드가 계산한 값(T1-196) */
  descriptionConfidence: number | null;
  outputObjectKey: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 업로드 사진 1장의 OCR 실행 요약(T1-196) — 원문 전체를 그대로 보여준다(요약·발췌하지 않는다, "OCR 결과 실제 원문 확인" 요청 사양). */
export interface Level1AssetOcrSummaryDto {
  assetId: string;
  provider: string | null;
  status: "SUCCESS" | "FAILED" | "PENDING" | "RUNNING" | null;
  extractedText: string | null;
  confidence: number | null;
  boundingBoxCount: number;
  error: string | null;
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
  /** 업로드된 사진 전체의 OCR 실행 결과(T1-196) — 실제 제품 사진도, 포장/라벨/사양표도 전부 포함한다. */
  ocrResults: Level1AssetOcrSummaryDto[];
  /** OCR 원문 ↔ Gemini Vision 분석 교차 검증 결과(T1-196) — 필드별 conflict를 그대로 보여준다. */
  factsVerification: FieldVerification[];
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
    private readonly ocrService: Level1AssetOcrService,
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

    // OCR 먼저(T1-196 요청 사양 3의 실행 순서: OCR → Product Facts 후보 →
    // Gemini 분석/교차검증) — 업로드된 모든 사진이 대상이다(실제 제품
    // 사진도, 포장/라벨/사양표/설명서/바코드도 전부 포함). OCR 실패가
    // 있어도 전체 생성을 막지 않는다(Level1AssetOcrService 헤더 주석
    // 참고) — Gemini Vision 분석은 OCR 없이도 동작해 왔고, 이 항목이
    // 새로 추가하는 정보는 "보강"이지 필수 관문이 아니다.
    const ocrOutcomes = await this.ocrService.runForAssets(
      assets.map((asset) => ({ id: asset.id, objectKey: asset.objectKey, mimeType: asset.mimeType })),
    );
    const ocrAssetIds = assets.map((asset) => asset.id);
    const successfulOcr = ocrOutcomes.filter((o) => o.status === "SUCCESS" && o.text.trim());
    const ocrFactCandidates = extractOcrFactCandidates(
      successfulOcr.map((o) => ({ assetId: o.assetId, text: o.text, confidence: o.confidence })),
    );
    const ocrArrayCandidates = extractOcrArrayFactCandidates(
      successfulOcr.map((o) => ({ assetId: o.assetId, text: o.text })),
    );
    // 1차 저장(OCR만으로 계산) — 아래 분석 호출이 실패해도 OCR 근거·후보는
    // 남는다. 분석이 성공하면 verifiedProductFacts를 더해 다시 계산해
    // 덮어쓴다.
    await this.prisma.level1MultiGeneration.update({
      where: { id: generationId },
      data: {
        ocrAssetIds,
        ocrFactsCandidates: { scalar: ocrFactCandidates, arrays: ocrArrayCandidates } as unknown as object,
        factsVerification: this.buildFactsVerification(ocrFactCandidates, null) as unknown as object,
      },
    });

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

      const factsVerification = this.buildFactsVerification(
        ocrFactCandidates,
        analysis.result.verifiedProductFacts,
      );

      await this.prisma.level1MultiGeneration.update({
        where: { id: generationId },
        data: {
          status: "GENERATING",
          analysisProvider: "gemini",
          analysisModel: analysis.model,
          analysisRawText: analysis.rawText,
          analysisAssetIds: assets.map((asset) => asset.id),
          verifiedProductFacts: analysis.result.verifiedProductFacts as unknown as object,
          factsVerification: factsVerification as unknown as object,
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
    // 섹션 설명의 근거(evidenceAssetIds, T1-196) — 시각 reference(실제
    // 제품 사진) + OCR로 정보가 확인된 사진(포장/라벨/사양표 등) 전체를
    // 합친다. 특정 문장이 어느 필드에서 왔는지까지 정밀 매핑하지는
    // 않는다 — "이 섹션 설명을 뒷받침하는 사진 전체"라는 보수적인 뜻으로
    // 쓴다(완료 보고에 그대로 밝힌다).
    const evidenceAssetIds = [...new Set([...actualProductAssetIds, ...ocrAssetIds])];
    const hasFactConflict = this.buildFactsVerification(
      ocrFactCandidates,
      analysis.result.verifiedProductFacts,
    ).some((f) => f.status === "conflict");

    for (const page of analysis.result.pagePlan) {
      const succeeded = await this.generateOnePage({
        generationId,
        productId,
        page,
        totalPages,
        apiKey,
        referenceImages,
        referenceAssetIds: actualProductAssetIds,
        evidenceAssetIds,
        hasFactConflict,
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

  /**
   * OCR 원문 후보 ↔ Gemini Vision 분석(verifiedProductFacts)을 필드별로
   * 교차 검증한다(T1-196). `visionFacts`가 null이면(분석 실패·아직 실행
   * 전) OCR 관측만으로 계산한다 — 그래도 OCR 후보끼리 서로 다르면
   * conflict가 나올 수 있다(예: 서로 다른 사진에서 다른 제조사가 읽힘).
   */
  private buildFactsVerification(
    ocrCandidates: OcrFactCandidate[],
    visionFacts: VerifiedProductFacts | null,
  ): FieldVerification[] {
    const observationsByField: Record<string, FieldObservation[]> = {};
    for (const field of OCR_FACT_FIELDS) {
      const observations: FieldObservation[] = [];
      const visionValue = visionFacts?.[field];
      if (typeof visionValue === "string" && visionValue.trim()) {
        observations.push({ source: "vision-analysis", value: visionValue });
      }
      for (const candidate of ocrCandidates) {
        if (candidate.field === field) {
          observations.push({ source: `ocr:${candidate.assetId}`, value: candidate.value });
        }
      }
      observationsByField[field] = observations;
    }
    return verifyFields(observationsByField);
  }

  /**
   * descriptionConfidence 계산(T1-196) — AI 주관 평가가 아니라 코드가
   * 결정하는 두 가지 사실만 반영한다: ① AI가 sectionDescription을 직접
   * 냈는지(대 보수적 fallback 문구인지) ② 이 생성 전체에 미해결
   * Product Facts conflict(factsVerification)가 있는지. "품질이
   * 좋다·정확하다"는 평가를 흉내 내지 않는다 — 이 값이 낮다고 설명이
   * 틀렸다는 뜻이 아니라, 확인해야 할 근거가 더 필요하다는 신호일 뿐이다.
   */
  private buildDescriptionConfidence(args: {
    isAiProvided: boolean;
    hasFactConflict: boolean;
  }): number {
    let score = args.isAiProvided ? 0.9 : 0.5;
    if (args.hasFactConflict) score -= 0.2;
    return Math.max(0, Math.min(1, score));
  }

  private async generateOnePage(args: {
    generationId: string;
    productId: string;
    page: PagePlanItem;
    totalPages: number;
    apiKey: string;
    referenceImages: { base64: string; mimeType: string }[];
    referenceAssetIds: string[];
    evidenceAssetIds: string[];
    hasFactConflict: boolean;
  }): Promise<boolean> {
    const {
      generationId,
      page,
      totalPages,
      apiKey,
      referenceImages,
      referenceAssetIds,
      evidenceAssetIds,
      hasFactConflict,
    } = args;
    const promptText = buildPageImagePrompt(page, totalPages);
    const generator = new GeminiPageImageGenerator({ apiKey });
    const isAiProvided = page.sectionDescription !== fallbackSectionDescription(page.pageRole, page.title);
    const descriptionConfidence = this.buildDescriptionConfidence({ isAiProvided, hasFactConflict });

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
          sectionDescription: page.sectionDescription,
          evidenceAssetIds,
          descriptionConfidence,
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
          sectionDescription: page.sectionDescription,
          evidenceAssetIds,
          descriptionConfidence,
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
    const ocrResults = await this.loadOcrSummaries(generation.ocrAssetIds);
    return this.toDto(generation, ocrResults);
  }

  /**
   * OCR 실행 이력 중 asset별 **최신** 결과만 골라 요약한다(T1-196). 원문
   * 전체를 그대로 노출한다("OCR 결과 실제 원문 확인" 요청 사양) —
   * 요약·발췌하지 않는다.
   */
  private async loadOcrSummaries(assetIds: string[]): Promise<Level1AssetOcrSummaryDto[]> {
    if (assetIds.length === 0) return [];
    const records = await this.prisma.level1AssetOcrResult.findMany({
      where: { assetId: { in: assetIds } },
      orderBy: { createdAt: "desc" },
    });
    const latestByAsset = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!latestByAsset.has(record.assetId)) latestByAsset.set(record.assetId, record);
    }
    return assetIds.map((assetId) => {
      const record = latestByAsset.get(assetId);
      if (!record) {
        return {
          assetId,
          provider: null,
          status: null,
          extractedText: null,
          confidence: null,
          boundingBoxCount: 0,
          error: null,
        };
      }
      const boundingBoxes = record.boundingBoxes as unknown[] | null;
      return {
        assetId,
        provider: record.provider,
        status: record.status,
        extractedText: record.extractedText,
        confidence: record.confidence,
        boundingBoxCount: Array.isArray(boundingBoxes) ? boundingBoxes.length : 0,
        error: record.error,
      };
    });
  }

  async getPageFile(pageId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const page = await this.prisma.level1DetailPage.findUnique({ where: { id: pageId } });
    if (!page || !page.outputObjectKey || !page.outputMimeType) {
      throw new NotFoundException(`페이지 이미지를 찾을 수 없습니다: ${pageId}`);
    }
    const buffer = await this.storage.getObject(page.outputObjectKey);
    return { buffer, mimeType: page.outputMimeType };
  }

  private toDto(
    generation: {
      id: string;
      productId: string;
      status: string;
      analysisProvider: string | null;
      analysisModel: string | null;
      verifiedProductFacts: unknown;
      analysisAssetIds: string[];
      actualProductAssetIds: string[];
      factsVerification: unknown;
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
        sectionDescription: string | null;
        evidenceAssetIds: string[];
        descriptionConfidence: number | null;
        outputObjectKey: string | null;
        outputMimeType: string | null;
        errorMessage: string | null;
        createdAt: Date;
        updatedAt: Date;
      }[];
      createdAt: Date;
      updatedAt: Date;
    },
    ocrResults: Level1AssetOcrSummaryDto[] = [],
  ): Level1MultiGenerationDto {
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
      ocrResults,
      factsVerification: (generation.factsVerification as FieldVerification[] | null) ?? [],
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
        sectionDescription: page.sectionDescription,
        evidenceAssetIds: page.evidenceAssetIds,
        descriptionConfidence: page.descriptionConfidence,
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
