import { Injectable } from "@nestjs/common";
import type {
  ProductProfileEngineResult,
  ProductProfileRun,
  ProductProfileRunInput,
  ProductProfileRunStore,
} from "@acos/core";
import { Prisma, type ProductProfile as ProductProfileRecord } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

function toRun(record: ProductProfileRecord): ProductProfileRun {
  return {
    id: record.id,
    status: record.status,
    imageFeatures: record.imageFeatures,
    profile: record.profile,
    error: record.error,
    attempts: record.attempts,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

/**
 * ProductProfileRunStore(Port)의 Prisma 어댑터. (TASK-5601, Sprint 35)
 * `PrismaOcrRunStore`(TASK-2901)와 같은 원칙 — 실행마다 새 레코드를 만든다.
 */
@Injectable()
export class PrismaProductProfileRunStore implements ProductProfileRunStore {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    input: ProductProfileRunInput,
    provider: string,
  ): Promise<ProductProfileRun> {
    const record = await this.prisma.productProfile.create({
      data: {
        imageIds: input.imageIds,
        projectId: input.projectId,
        ocrText: input.ocrText,
        provider,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    return toRun(record);
  }

  async markSuccess(
    id: string,
    result: ProductProfileEngineResult,
    attempts: number,
  ): Promise<ProductProfileRun> {
    const record = await this.prisma.productProfile.update({
      where: { id },
      data: {
        status: "SUCCESS",
        imageFeatures: result.imageFeatures as unknown as Prisma.InputJsonValue,
        profile: result.profile as unknown as Prisma.InputJsonValue,
        pageCopy: result.pageCopy as unknown as Prisma.InputJsonValue,
        html: result.html,
        css: result.css,
        error: null,
        attempts,
        completedAt: new Date(),
      },
    });
    return toRun(record);
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
  ): Promise<ProductProfileRun> {
    const record = await this.prisma.productProfile.update({
      where: { id },
      data: {
        status: "FAILED",
        error,
        attempts,
        completedAt: new Date(),
      },
    });
    return toRun(record);
  }
}
