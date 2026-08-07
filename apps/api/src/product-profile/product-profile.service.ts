import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  ProductProfileEngine,
  ProductProfileExecutionService,
} from "@acos/core";
import type { VisionImageInput } from "@acos/core";
import type { ProductProfileDto } from "@acos/shared";
import type { ProductProfile as ProductProfileRecord } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PrismaProductProfileRunStore } from "./prisma-product-profile-run.store";

function toDto(record: ProductProfileRecord): ProductProfileDto {
  return {
    id: record.id,
    imageIds: record.imageIds,
    projectId: record.projectId,
    status: record.status,
    ocrText: record.ocrText,
    imageFeatures: record.imageFeatures as ProductProfileDto["imageFeatures"],
    profile: record.profile as ProductProfileDto["profile"],
    provider: record.provider,
    error: record.error,
    attempts: record.attempts,
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Product Detail Engine V1. (TASK-5601, Sprint 35 — CTO 지시 "Sprint 35
 * Phase 1")
 *
 * STEP 1(업로드)·STEP 2(OCR)는 기존 `/uploads/images`·
 * `POST /images/:imageId/ocr`를 그대로 쓴다 — 이미 실 Provider로 동작하는
 * 코드를 다시 만들지 않는다. 이 서비스는 STEP 3(이미지 특징 분석)과
 * STEP 4(Product Profile 통합)만 담당한다.
 *
 * Project·Company Brain 의존이 없다 — "사진만 넣으면"이 V1의 전제다.
 * `projectId`는 업로드 때 밝힌 소속을 그대로 옮길 뿐, 짐작하지 않는다.
 */
@Injectable()
export class ProductProfileService {
  private readonly execution: ProductProfileExecutionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    engine: ProductProfileEngine,
    store: PrismaProductProfileRunStore,
    // AI 비용 예산 (TASK-3001, CTO 결정 2901-④) — LLM과 같은 상한을 쓴다
    @Optional() private readonly budget?: LlmBudgetService,
  ) {
    this.execution = new ProductProfileExecutionService(engine, store, {
      // 한 실행에 실 LLM 호출이 2건(이미지 분석 + 통합) 묶여 있다. 자동
      // 재시도를 하면 이미 성공한 절반까지 다시 불러 실제 비용이 배로
      // 나간다 — 재시도는 사람이 다시 눌러서 한다 (CTO 결정 1301-①과 같은
      // 판단: 실 호출은 명시적으로만 돈다).
      maxAttempts: 1,
    });
  }

  async run(imageIds: string[], projectId?: string): Promise<ProductProfileDto> {
    const ids = [
      ...new Set(imageIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    ];
    if (ids.length === 0) {
      throw new BadRequestException("imageIds는 최소 1개 이상이어야 합니다.");
    }

    const images = await this.prisma.image.findMany({
      where: { id: { in: ids } },
    });
    if (images.length !== ids.length) {
      const found = new Set(images.map((image) => image.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new NotFoundException(
        `이미지를 찾을 수 없습니다: ${missing.join(", ")}`,
      );
    }

    await this.budget?.assertWithinBudget({
      what: "Product Profile 생성 (이미지 분석 + 통합)",
    });

    // STEP 2(OCR)가 이미 돌았다면 그 텍스트를 근거로 쓴다 — 없어도 STEP 3는
    // 이미지만으로 진행된다(순수 제품 사진에는 글자가 없을 수 있다)
    const ocrTexts: string[] = [];
    for (const image of images) {
      const latest = await this.prisma.ocrResult.findFirst({
        where: { imageId: image.id, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
      });
      if (latest?.extractedText) {
        ocrTexts.push(latest.extractedText);
      }
    }

    const visionImages: VisionImageInput[] = images.map((image) => ({
      id: image.id,
      mimeType: image.mimeType,
      getBytes: () => this.storage.getObject(image.key),
    }));

    const normalizedProjectId = projectId?.trim() || undefined;
    const run = await this.execution.execute(
      {
        imageIds: ids,
        projectId: normalizedProjectId ?? null,
        ocrText: ocrTexts.length > 0 ? ocrTexts.join("\n\n---\n\n") : null,
      },
      { images: visionImages, ocrTexts, projectId: normalizedProjectId },
    );

    // 실패도 정상 응답이다(OCR·Analysis와 같은 원칙) — status 필드가
    // 사실을 말한다. "실행했지만 실패했다"를 5xx로 감추지 않는다.
    const record = await this.prisma.productProfile.findUniqueOrThrow({
      where: { id: run.id },
    });
    return toDto(record);
  }

  async get(id: string): Promise<ProductProfileDto> {
    const record = await this.prisma.productProfile.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException(`Product Profile을 찾을 수 없습니다: ${id}`);
    }
    return toDto(record);
  }

  async list(take: number): Promise<ProductProfileDto[]> {
    const bounded = Math.min(
      Math.max(Number.isFinite(take) ? take : 20, 1),
      100,
    );
    const records = await this.prisma.productProfile.findMany({
      orderBy: { updatedAt: "desc" },
      take: bounded,
    });
    return records.map(toDto);
  }
}
