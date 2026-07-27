import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { OcrProvider } from "@acos/core";
import { OcrExecutionService } from "@acos/core";
import type { OcrResultDto } from "@acos/shared";
import type { OcrResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { OCR_PROVIDER } from "./ocr.constants";
import { PrismaOcrRunStore } from "./prisma-ocr-run.store";

function toDto(record: OcrResult, includeRaw: boolean): OcrResultDto {
  return {
    id: record.id,
    imageId: record.imageId,
    provider: record.provider,
    status: record.status,
    extractedText: record.extractedText,
    confidence: record.confidence,
    ...(includeRaw ? { rawJson: record.rawJson } : {}),
    error: record.error,
    attempts: record.attempts,
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly execution: OcrExecutionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    store: PrismaOcrRunStore,
    @Inject(OCR_PROVIDER) provider: OcrProvider,
  ) {
    this.execution = new OcrExecutionService(provider, store, {
      maxAttempts: Math.max(1, Number(process.env.OCR_MAX_ATTEMPTS ?? 3)),
      onAttemptFailed: (attempt, error) =>
        this.logger.warn(`OCR attempt ${attempt} failed: ${error}`),
    });
  }

  /** OCR 실행 — 호출할 때마다 새 실행 레코드가 쌓인다. (이력 보존, 재실행) */
  async runOcr(imageId: string): Promise<OcrResultDto> {
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
    });
    if (!image) {
      throw new NotFoundException(`이미지를 찾을 수 없습니다: ${imageId}`);
    }

    const run = await this.execution.execute(imageId, image.mimeType, () =>
      this.storage.getObject(image.key),
    );
    const record = await this.prisma.ocrResult.findUniqueOrThrow({
      where: { id: run.id },
    });
    return toDto(record, true);
  }

  /** 가장 최근 실행 결과를 반환한다. */
  async getLatestByImageId(
    imageId: string,
    includeRaw: boolean,
  ): Promise<OcrResultDto> {
    const record = await this.prisma.ocrResult.findFirst({
      where: { imageId },
      orderBy: { createdAt: "desc" },
    });
    if (!record) {
      throw new NotFoundException(
        `OCR 결과가 없습니다. POST /images/${imageId}/ocr 로 실행해 주세요.`,
      );
    }
    return toDto(record, includeRaw);
  }

  /** 이미지의 전체 실행 이력 (최신순) */
  async getHistoryByImageId(imageId: string): Promise<OcrResultDto[]> {
    const records = await this.prisma.ocrResult.findMany({
      where: { imageId },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => toDto(record, false));
  }

  async list(take: number): Promise<OcrResultDto[]> {
    const bounded = Math.min(
      Math.max(Number.isFinite(take) ? take : 20, 1),
      100,
    );
    const records = await this.prisma.ocrResult.findMany({
      orderBy: { updatedAt: "desc" },
      take: bounded,
    });
    return records.map((record) => toDto(record, false));
  }
}
