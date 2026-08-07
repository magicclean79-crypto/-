import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DesignReviewEngine } from "@acos/core";
import type { VisionImageInput } from "@acos/core";
import type { DesignReviewDto } from "@acos/shared";
import type { DesignReview as DesignReviewRecord, Prisma } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

function toDto(record: DesignReviewRecord): DesignReviewDto {
  return {
    id: record.id,
    imageIds: record.imageIds,
    category: record.category,
    notes: record.notes,
    status: record.result ? "SUCCESS" : "FAILED",
    result: record.result as unknown as DesignReviewDto["result"],
    provider: record.provider,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
    productProfileId: record.productProfileId,
  };
}

/**
 * 디자인 리뷰 서비스. (Sprint 35 — "시장 디자인 패턴 학습" CTO 지시)
 *
 * "Claude는 프로그램 개발, Gemini는 디자인 평가"라는 역할 분담의 연결
 * 지점이다 — 이 서비스는 스크린샷(기존 업로드 이미지 id 재사용)을 받아
 * `DesignReviewEngine`에 넘기고, 결과를 저장한다. `ProductProfileService`
 * 와 달리 재시도 상태 머신이 없다 — 단발성 평가라 실패도 그대로 한
 * 레코드에 남긴다(별도 RUNNING 상태 없음).
 *
 * **아직 어떤 화면에서도 호출되지 않는다** — Gemini API 키가 없어
 * `LLM_ROUTE_DESIGN_REVIEW`가 설정되지 않으면 기본 Provider로 라우팅될
 * 뿐이다(그래도 실제 비용이 나가므로, 키가 준비되기 전까지는 사람이
 * 명시적으로 호출하지 않아야 한다).
 */
@Injectable()
export class DesignReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly engine: DesignReviewEngine,
    @Optional() private readonly budget?: LlmBudgetService,
  ) {}

  async review(
    imageIds: string[],
    category: string,
    notes?: string,
    provider?: string,
    productProfileId?: string,
  ): Promise<DesignReviewDto> {
    const ids = [
      ...new Set(imageIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    ];
    if (ids.length === 0) {
      throw new BadRequestException("imageIds는 최소 1개 이상이어야 합니다.");
    }
    const trimmedCategory = category?.trim();
    if (!trimmedCategory) {
      throw new BadRequestException("category는 필수입니다.");
    }

    const images = await this.prisma.image.findMany({
      where: { id: { in: ids } },
    });
    if (images.length !== ids.length) {
      const found = new Set(images.map((image) => image.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new NotFoundException(`이미지를 찾을 수 없습니다: ${missing.join(", ")}`);
    }

    await this.budget?.assertWithinBudget({ what: "디자인 리뷰 (Gemini 디자인 디렉터)" });

    const visionImages: VisionImageInput[] = images.map((image) => ({
      id: image.id,
      mimeType: image.mimeType,
      getBytes: () => this.storage.getObject(image.key),
    }));

    const trimmedNotes = notes?.trim() || null;
    const trimmedProductProfileId = productProfileId?.trim() || null;

    // 실패도 정상 응답이다(다른 AI 기능과 같은 원칙) — status 필드가
    // 사실을 말한다. "실행했지만 실패했다"를 5xx로 감추지 않는다.
    try {
      const { result, raw } = await this.engine.run({
        images: visionImages,
        category: trimmedCategory,
        notes: trimmedNotes ?? undefined,
        provider: provider?.trim() || undefined,
      });
      const record = await this.prisma.designReview.create({
        data: {
          imageIds: ids,
          category: trimmedCategory,
          notes: trimmedNotes,
          result: result as unknown as Prisma.InputJsonValue,
          provider: raw.provider,
          productProfileId: trimmedProductProfileId,
        },
      });
      return toDto(record);
    } catch (error) {
      const record = await this.prisma.designReview.create({
        data: {
          imageIds: ids,
          category: trimmedCategory,
          notes: trimmedNotes,
          error: error instanceof Error ? error.message : String(error),
          productProfileId: trimmedProductProfileId,
        },
      });
      return toDto(record);
    }
  }

  async get(id: string): Promise<DesignReviewDto> {
    const record = await this.prisma.designReview.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`디자인 리뷰를 찾을 수 없습니다: ${id}`);
    }
    return toDto(record);
  }

  async list(take: number, productProfileId?: string): Promise<DesignReviewDto[]> {
    const bounded = Math.min(Math.max(Number.isFinite(take) ? take : 20, 1), 100);
    const records = await this.prisma.designReview.findMany({
      where: productProfileId ? { productProfileId } : undefined,
      orderBy: { createdAt: "desc" },
      take: bounded,
    });
    return records.map(toDto);
  }
}
