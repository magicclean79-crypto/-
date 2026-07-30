import { Injectable } from "@nestjs/common";
import { estimateOcrCost } from "@acos/core";
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

  /**
   * 성공 기록 — **비용도 함께 남긴다** (TASK-3001, CTO 결정 2901-④).
   *
   * 비용은 성공한 호출에만 붙입니다. 실패한 호출도 Provider에 따라 과금될 수
   * 있지만 우리는 그것을 알 수 없고, **모르는 것을 숫자로 적으면 예산이
   * 거짓이 됩니다.** 대신 실패 호출 수는 관측에 그대로 남습니다.
   *
   * 가격표에 없는 엔진은 `null`(미산정)입니다 — 0으로 채우면 예산 상한이
   * 조용히 무력해집니다.
   */
  async markSuccess(
    id: string,
    result: OcrRecognition,
    attempts: number,
  ): Promise<OcrRun> {
    // provider는 start()가 남긴 값이 진실이다 — 다시 추측하지 않는다
    const current = await this.prisma.ocrResult.findUniqueOrThrow({
      where: { id },
      select: { provider: true, units: true },
    });
    const cost = estimateOcrCost(current.provider, current.units);

    const record = await this.prisma.ocrResult.update({
      where: { id },
      data: {
        status: "SUCCESS",
        extractedText: result.text,
        confidence: result.confidence,
        rawJson: result.raw as Prisma.InputJsonValue,
        error: null,
        attempts,
        cost,
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
