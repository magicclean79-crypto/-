import { Injectable } from "@nestjs/common";
import type { OcrRecognition, OcrRun, OcrRunStore } from "@acos/core";
import { Prisma, type OcrResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export function toOcrRun(record: OcrResult): OcrRun {
  return {
    id: record.id,
    imageId: record.imageId,
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
 * OcrRunStore(Port)의 Prisma 어댑터.
 * 실행마다 새 레코드를 만들어 Image당 실행 이력(1:N)을 보존한다.
 */
@Injectable()
export class PrismaOcrRunStore implements OcrRunStore {
  constructor(private readonly prisma: PrismaService) {}

  async start(imageId: string, provider: string): Promise<OcrRun> {
    const record = await this.prisma.ocrResult.create({
      data: {
        imageId,
        provider,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    return toOcrRun(record);
  }

  async markSuccess(
    id: string,
    result: OcrRecognition,
    attempts: number,
  ): Promise<OcrRun> {
    const record = await this.prisma.ocrResult.update({
      where: { id },
      data: {
        status: "SUCCESS",
        extractedText: result.text,
        confidence: result.confidence,
        rawJson: result.raw as Prisma.InputJsonValue,
        error: null,
        attempts,
        completedAt: new Date(),
      },
    });
    return toOcrRun(record);
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
  ): Promise<OcrRun> {
    const record = await this.prisma.ocrResult.update({
      where: { id },
      data: {
        status: "FAILED",
        error,
        attempts,
        completedAt: new Date(),
      },
    });
    return toOcrRun(record);
  }
}
