import { Injectable } from "@nestjs/common";
import type {
  AnalysisRecognition,
  AnalysisRun,
  AnalysisRunStore,
} from "@acos/core";
import type { ProductAnalysis } from "@acos/shared";
import { Prisma, type AnalysisResult } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export function toAnalysisRun(record: AnalysisResult): AnalysisRun {
  return {
    id: record.id,
    productId: record.productId,
    provider: record.provider,
    status: record.status,
    result: record.result as ProductAnalysis | null,
    rawJson: record.rawJson,
    error: record.error,
    attempts: record.attempts,
    applied: record.applied,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

/**
 * AnalysisRunStore(Port)의 Prisma 어댑터.
 * 실행마다 새 레코드를 만들어 Product당 실행 이력(1:N)을 보존한다.
 */
@Injectable()
export class PrismaAnalysisRunStore implements AnalysisRunStore {
  constructor(private readonly prisma: PrismaService) {}

  async start(productId: string, provider: string): Promise<AnalysisRun> {
    const record = await this.prisma.analysisResult.create({
      data: {
        productId,
        provider,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    return toAnalysisRun(record);
  }

  async markSuccess(
    id: string,
    recognition: AnalysisRecognition,
    attempts: number,
  ): Promise<AnalysisRun> {
    const record = await this.prisma.analysisResult.update({
      where: { id },
      data: {
        status: "SUCCESS",
        result: recognition.analysis as unknown as Prisma.InputJsonValue,
        rawJson: recognition.raw as Prisma.InputJsonValue,
        error: null,
        attempts,
        completedAt: new Date(),
        // 실제 호출된 Provider로 이력 갱신 (TASK-1002, CTO 결정 1001-③) —
        // 라우팅/Failover로 시작 시점과 다를 수 있다
        ...(recognition.providerName
          ? { provider: recognition.providerName }
          : {}),
      },
    });
    return toAnalysisRun(record);
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
  ): Promise<AnalysisRun> {
    const record = await this.prisma.analysisResult.update({
      where: { id },
      data: {
        status: "FAILED",
        error,
        attempts,
        completedAt: new Date(),
      },
    });
    return toAnalysisRun(record);
  }
}
