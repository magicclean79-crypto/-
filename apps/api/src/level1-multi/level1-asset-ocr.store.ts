import { Injectable, Logger } from "@nestjs/common";
import type { OcrRecognition, OcrRun, OcrRunStore } from "@acos/core";
import { Prisma, type Level1AssetOcrResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { extractGoogleVisionBoundingBoxes } from "./ocr-bounding-boxes";

function toOcrRun(record: Level1AssetOcrResult): OcrRun {
  return {
    id: record.id,
    imageId: record.assetId,
    provider: record.provider,
    status: record.status,
    extractedText: record.extractedText,
    confidence: record.confidence,
    rawJson: record.rawJson,
    error: record.error,
    attempts: record.attempts,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

/**
 * `OcrRunStore`(Port, `@acos/core`)의 Level1Asset 어댑터 (T1-196).
 *
 * `apps/api/src/ocr/prisma-ocr-run.store.ts`(Image용)와 같은 목적이지만
 * `Level1AssetOcrResult` 테이블을 쓴다 — Image·Level1Asset은 서로 다른
 * 테이블이라 하나의 store로 합칠 수 없다(FK가 다르다). 비용/가격표 연동은
 * 이 작업 범위가 아니다(image_gen과 마찬가지로 이 모듈은 기존 비용 체계에
 * 손대지 않는다) — OCR 자체의 실 호출 비용은 Google Cloud Console 청구서
 * 기준이며, 이 프로젝트의 로컬 가격표 체계와는 별개다.
 */
@Injectable()
export class Level1AssetOcrStore implements OcrRunStore {
  private readonly logger = new Logger(Level1AssetOcrStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async start(assetId: string, provider: string): Promise<OcrRun> {
    const record = await this.prisma.level1AssetOcrResult.create({
      data: { assetId, provider, status: "RUNNING", startedAt: new Date() },
    });
    return toOcrRun(record);
  }

  async markSuccess(
    id: string,
    result: OcrRecognition,
    attempts: number,
  ): Promise<OcrRun> {
    const boundingBoxes = extractGoogleVisionBoundingBoxes(result.raw);
    if (boundingBoxes === null) {
      this.logger.debug(`level1 OCR ${id}: bounding box 없음 (provider가 제공하지 않음)`);
    }
    const record = await this.prisma.level1AssetOcrResult.update({
      where: { id },
      data: {
        status: "SUCCESS",
        extractedText: result.text,
        confidence: result.confidence,
        rawJson: result.raw as Prisma.InputJsonValue,
        boundingBoxes: (boundingBoxes ?? undefined) as Prisma.InputJsonValue | undefined,
        error: null,
        attempts,
        completedAt: new Date(),
      },
    });
    return toOcrRun(record);
  }

  async markFailed(id: string, error: string, attempts: number): Promise<OcrRun> {
    const record = await this.prisma.level1AssetOcrResult.update({
      where: { id },
      data: { status: "FAILED", error, attempts, completedAt: new Date() },
    });
    return toOcrRun(record);
  }
}
