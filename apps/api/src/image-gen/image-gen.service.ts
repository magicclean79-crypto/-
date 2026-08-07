import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { ImageEditProvider } from "@acos/core";
import type { GenerateHeroImageResult, ImageDto } from "@acos/shared";
import type { Image } from "@prisma/client";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { IMAGE_EDIT_PROVIDER } from "./image-gen.constants";

function toDto(image: Image): ImageDto {
  return {
    id: image.id,
    key: image.key,
    url: image.url,
    originalName: image.originalName,
    mimeType: image.mimeType,
    size: image.size,
    productId: image.productId,
    projectId: image.projectId,
    createdAt: image.createdAt.toISOString(),
    kind: image.kind as ImageDto["kind"],
    sourceImageId: image.sourceImageId,
    generationMetadata: image.generationMetadata as ImageDto["generationMetadata"],
  };
}

/**
 * 이미지 생성/편집 서비스. (Sprint 36 — CTO 지시: "제미나이는 제품과 어울리는
 * 배경생성, 상품이미지외 뒷배경 제거, 생성한 배경에 자연스럽게 제품 이미지
 * 합성해")
 *
 * `DesignReviewService`와 같은 원칙 — 단발성 실 API 호출이라 재시도
 * 상태 머신이 없다. 실패도 예외로 던지고, 호출자(컨트롤러)가 그대로
 * 사용자에게 보여준다(감추지 않는다).
 *
 * 배경 제거·배경 생성·합성은 전부 같은 `ImageEditProvider.edit()` 메서드
 * 하나로 표현된다(입력 이미지 개수·프롬프트만 다름 — 실측 확인,
 * 2026-08-08). 결과 이미지는 `Image` 테이블에 `kind`로 구분해 새 레코드로
 * 저장한다 — 원본을 덮어쓰지 않는다.
 */
@Injectable()
export class ImageGenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(IMAGE_EDIT_PROVIDER) private readonly provider: ImageEditProvider,
    @Optional() private readonly budget?: LlmBudgetService,
  ) {}

  private async getImage(id: string): Promise<Image> {
    const image = await this.prisma.image.findUnique({ where: { id } });
    if (!image) {
      throw new NotFoundException(`이미지를 찾을 수 없습니다: ${id}`);
    }
    return image;
  }

  private async storeResult(options: {
    imageBytes: string;
    mimeType: string;
    kind: "BACKGROUND_REMOVED" | "BACKGROUND_GENERATED" | "COMPOSITED";
    sourceImageId: string;
    prompt: string;
    model: string;
    backgroundImageId?: string;
  }): Promise<ImageDto> {
    const extension = options.mimeType === "image/png" ? "png" : "jpg";
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const key = `images/${yyyy}/${mm}/${randomUUID()}.${extension}`;
    const buffer = Buffer.from(options.imageBytes, "base64");
    const url = await this.storage.putObject(key, buffer, options.mimeType);
    const record = await this.prisma.image.create({
      data: {
        key,
        url,
        originalName: `${options.kind.toLowerCase()}-${randomUUID()}.${extension}`,
        mimeType: options.mimeType,
        size: buffer.length,
        kind: options.kind,
        sourceImageId: options.sourceImageId,
        generationMetadata: {
          prompt: options.prompt,
          provider: this.provider.name,
          model: options.model,
          ...(options.backgroundImageId ? { backgroundImageId: options.backgroundImageId } : {}),
        },
      },
    });
    return toDto(record);
  }

  /** 제품 사진에서 배경을 제거한다 — 결과는 kind=BACKGROUND_REMOVED 새 이미지로 저장 */
  async removeBackground(imageId: string): Promise<ImageDto> {
    const source = await this.getImage(imageId);
    await this.budget?.assertWithinBudget({ what: "이미지 배경 제거 (Gemini)" });
    const bytes = await this.storage.getObject(source.key);
    const prompt =
      "이 제품 사진에서 제품만 남기고 배경을 완전히 제거해서 깨끗한 흰색 배경으로 바꿔줘. " +
      "제품의 형태와 색상, 비율은 그대로 유지해.";
    const result = await this.provider.edit({
      prompt,
      images: [{ mimeType: source.mimeType, base64: bytes.toString("base64") }],
    });
    return this.storeResult({
      imageBytes: result.imageBytes,
      mimeType: result.mimeType,
      kind: "BACKGROUND_REMOVED",
      sourceImageId: source.id,
      prompt,
      model: result.model,
    });
  }

  /** 제품과 어울리는 배경 이미지를 새로 생성한다(제품은 포함하지 않음) */
  async generateBackground(sourceImageId: string, backgroundPrompt: string): Promise<ImageDto> {
    const trimmed = backgroundPrompt?.trim();
    if (!trimmed) {
      throw new BadRequestException("prompt는 필수입니다.");
    }
    const source = await this.getImage(sourceImageId);
    await this.budget?.assertWithinBudget({ what: "이미지 배경 생성 (Gemini)" });
    const prompt = `${trimmed} 제품 자체는 이미지에 넣지 말고 배경만 만들어줘.`;
    const bytes = await this.storage.getObject(source.key);
    const result = await this.provider.edit({
      prompt,
      images: [{ mimeType: source.mimeType, base64: bytes.toString("base64") }],
    });
    return this.storeResult({
      imageBytes: result.imageBytes,
      mimeType: result.mimeType,
      kind: "BACKGROUND_GENERATED",
      sourceImageId: source.id,
      prompt,
      model: result.model,
    });
  }

  /** 배경이 제거된 제품 이미지를 생성된 배경 위에 합성한다 */
  async composite(productImageId: string, backgroundImageId: string): Promise<ImageDto> {
    const [product, background] = await Promise.all([
      this.getImage(productImageId),
      this.getImage(backgroundImageId),
    ]);
    await this.budget?.assertWithinBudget({ what: "이미지 합성 (Gemini)" });
    const prompt =
      "첫 번째 이미지(배경이 제거된 제품)를 두 번째 이미지(배경) 위에 자연스럽게 합성해줘. " +
      "그림자와 조명을 배경에 맞게 보정해줘.";
    const [productBytes, backgroundBytes] = await Promise.all([
      this.storage.getObject(product.key),
      this.storage.getObject(background.key),
    ]);
    const result = await this.provider.edit({
      prompt,
      images: [
        { mimeType: product.mimeType, base64: productBytes.toString("base64") },
        { mimeType: background.mimeType, base64: backgroundBytes.toString("base64") },
      ],
    });
    return this.storeResult({
      imageBytes: result.imageBytes,
      mimeType: result.mimeType,
      kind: "COMPOSITED",
      sourceImageId: product.sourceImageId ?? product.id,
      prompt,
      model: result.model,
      backgroundImageId: background.id,
    });
  }

  /** 배경 제거 → 배경 생성 → 합성을 한 번에 실행하는 Hero 이미지 파이프라인 */
  async generateHero(imageId: string, backgroundPrompt?: string): Promise<GenerateHeroImageResult> {
    const original = await this.getImage(imageId);
    const backgroundRemoved = await this.removeBackground(imageId);
    const backgroundGenerated = await this.generateBackground(
      imageId,
      backgroundPrompt?.trim() ||
        "이 제품이 실제로 쓰이는 자연스러운 생활 공간 배경을 만들어줘 — 밝고 깨끗한 실내 또는 실외 공간.",
    );
    const composited = await this.composite(backgroundRemoved.id, backgroundGenerated.id);
    return {
      original: toDto(original),
      backgroundRemoved,
      backgroundGenerated,
      composited,
    };
  }
}
