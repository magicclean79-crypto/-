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
        userRequirement: input.userRequirement ?? null,
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
        // 호출자가 templateKey를 안 줬으면 엔진이 자동 선택한 값을 쓴다
        // (T1-77) — start()에는 요청값(없으면 null)만 있었고, 실제로
        // 렌더링에 쓰인 값은 여기(markSuccess)에서만 알 수 있다. 이전에는
        // 이 필드를 갱신하지 않아 "실제로 뭘 썼는지"가 기록에 남지 않았다.
        templateKey: result.templateKey,
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
