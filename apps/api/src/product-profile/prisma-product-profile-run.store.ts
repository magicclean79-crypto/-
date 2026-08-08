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
        templateKey: input.templateKey ?? null,
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
    // 사진 유형 자동 분류 결과를 원본 Image 레코드에 반영한다(CTO 지시,
    // 2026-08-08 — 최우선 기능). Product Profile 실행 자체가 실패해도 이미
    // 분류는 무의미하므로 markSuccess에서만 반영한다.
    await Promise.all(
      result.photoTypeByImageId.map(({ imageId, photoType }) =>
        this.prisma.image.update({ where: { id: imageId }, data: { photoType } }),
      ),
    );
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
