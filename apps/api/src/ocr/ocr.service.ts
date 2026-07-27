import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import type { OcrResultDto } from "@acos/shared";
import { Prisma, type OcrResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import {
  OCR_PROVIDER,
  type OcrProvider,
  type OcrRecognition,
} from "./ocr-provider.interface";

const RETRY_BASE_DELAY_MS = 500;

function toDto(result: OcrResult, includeRaw: boolean): OcrResultDto {
  return {
    id: result.id,
    imageId: result.imageId,
    provider: result.provider,
    status: result.status,
    text: result.text,
    confidence: result.confidence,
    ...(includeRaw ? { raw: result.raw } : {}),
    error: result.error,
    attempts: result.attempts,
    completedAt: result.completedAt?.toISOString() ?? null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly maxAttempts = Math.max(
    1,
    Number(process.env.OCR_MAX_ATTEMPTS ?? 3),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(OCR_PROVIDER) private readonly provider: OcrProvider,
  ) {}

  /**
   * 이미지 1건에 대해 OCR을 실행한다.
   * 이미 결과가 있으면 초기화 후 다시 실행하므로 재실행에도 사용된다.
   * Provider 호출은 maxAttempts회까지 지수 백오프로 재시도한다.
   */
  async runOcr(imageId: string): Promise<OcrResultDto> {
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
    });
    if (!image) {
      throw new NotFoundException(`이미지를 찾을 수 없습니다: ${imageId}`);
    }

    // 재실행 시 기존 결과를 초기화하고 PROCESSING으로 전환한다.
    const base = {
      provider: this.provider.name,
      status: "PROCESSING" as const,
      text: null,
      confidence: null,
      raw: Prisma.DbNull,
      error: null,
      attempts: 0,
      completedAt: null,
    };
    let record = await this.prisma.ocrResult.upsert({
      where: { imageId },
      create: { imageId, ...base, raw: undefined },
      update: base,
    });

    let buffer: Buffer;
    try {
      buffer = await this.storage.getObject(image.key);
    } catch {
      record = await this.prisma.ocrResult.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          error: "스토리지에서 이미지를 읽을 수 없습니다.",
        },
      });
      return toDto(record, true);
    }

    let recognition: OcrRecognition | null = null;
    let lastError = "";
    let attempts: number;

    for (attempts = 1; attempts <= this.maxAttempts; attempts++) {
      try {
        recognition = await this.provider.recognize(buffer, image.mimeType);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `OCR attempt ${attempts}/${this.maxAttempts} failed for image ${imageId}: ${lastError}`,
        );
        if (attempts < this.maxAttempts) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempts - 1));
        }
      }
    }

    if (recognition) {
      record = await this.prisma.ocrResult.update({
        where: { id: record.id },
        data: {
          status: "COMPLETED",
          text: recognition.text,
          confidence: recognition.confidence,
          raw: recognition.raw as Prisma.InputJsonValue,
          error: null,
          attempts,
          completedAt: new Date(),
        },
      });
    } else {
      record = await this.prisma.ocrResult.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          error: lastError || "OCR 처리에 실패했습니다.",
          attempts: this.maxAttempts,
        },
      });
    }
    return toDto(record, true);
  }

  async getByImageId(
    imageId: string,
    includeRaw: boolean,
  ): Promise<OcrResultDto> {
    const record = await this.prisma.ocrResult.findUnique({
      where: { imageId },
    });
    if (!record) {
      throw new NotFoundException(
        `OCR 결과가 없습니다. POST /images/${imageId}/ocr 로 실행해 주세요.`,
      );
    }
    return toDto(record, includeRaw);
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
