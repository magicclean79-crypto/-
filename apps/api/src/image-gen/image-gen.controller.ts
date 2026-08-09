import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import type {
  CompositeImageRequest,
  GenerateBackgroundRequest,
  GenerateHeroImageRequest,
  GenerateHeroImageResult,
  GenerateImageCandidatesRequest,
  GenerateImageCandidatesResult,
  GenerateUsageShotsRequest,
  GenerateUsageShotsResult,
  ImageCategory,
  ImageDto,
  SelectImageRequest,
} from "@acos/shared";
import { IMAGE_CATEGORIES } from "@acos/shared";
import { ImageGenService } from "./image-gen.service";

/**
 * 이미지 생성/편집. (Sprint 36 — Gemini 배경 제거·배경 생성·제품 합성)
 * 실 Gemini 호출 1건당 과금 발생. 각 엔드포인트는 개별 단계이고,
 * `/image-gen/hero`는 세 단계를 한 번에 실행한다.
 */
@Controller("image-gen")
export class ImageGenController {
  constructor(private readonly service: ImageGenService) {}

  @Post("remove-background")
  async removeBackground(@Body() body: { imageId?: string }): Promise<ImageDto> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.removeBackground(body.imageId);
  }

  @Post("generate-background")
  async generateBackground(@Body() body: GenerateBackgroundRequest): Promise<ImageDto> {
    if (!body?.sourceImageId) {
      throw new BadRequestException("sourceImageId는 필수입니다.");
    }
    return this.service.generateBackground(body.sourceImageId, body.prompt);
  }

  @Post("composite")
  async composite(@Body() body: CompositeImageRequest): Promise<ImageDto> {
    if (!body?.productImageId || !body?.backgroundImageId) {
      throw new BadRequestException("productImageId, backgroundImageId는 필수입니다.");
    }
    return this.service.composite(body.productImageId, body.backgroundImageId);
  }

  /** 배경 제거 → 배경 생성 → 합성을 한 번에 실행 */
  @Post("hero")
  async generateHero(@Body() body: GenerateHeroImageRequest): Promise<GenerateHeroImageResult> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.generateHero(body.imageId, body.backgroundPrompt);
  }

  /** 실사용 장면 여러 샷 생성(원거리/근거리) — CTO 실측으로 확인된 방식(2026-08-08) */
  @Post("usage-shots")
  async generateUsageShots(@Body() body: GenerateUsageShotsRequest): Promise<GenerateUsageShotsResult> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.generateUsageShots(body.imageId, body.scenePrompt, body.shotCount);
  }

  /** 카테고리별(Hero/사용장면/디테일/특징강조/구성품/기타) 이미지 후보 여러 버전 생성 */
  @Post("candidates")
  async generateCandidates(
    @Body() body: GenerateImageCandidatesRequest,
  ): Promise<GenerateImageCandidatesResult> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    if (!IMAGE_CATEGORIES.includes(body.category)) {
      throw new BadRequestException(`category는 다음 중 하나여야 합니다: ${IMAGE_CATEGORIES.join(", ")}`);
    }
    return this.service.generateImageCandidates(body.imageId, body.category, {
      count: body.count,
      style: body.style,
      scenePrompt: body.scenePrompt,
    });
  }

  /** 특정 원본 사진의 한 카테고리에 대해 지금까지 생성된 모든 버전을 조회 */
  @Get("candidates")
  async listCandidates(
    @Query("sourceImageId") sourceImageId?: string,
    @Query("category") category?: string,
  ): Promise<{ results: ImageDto[] }> {
    if (!sourceImageId || !category) {
      throw new BadRequestException("sourceImageId, category는 필수입니다.");
    }
    if (!IMAGE_CATEGORIES.includes(category as ImageCategory)) {
      throw new BadRequestException(`category는 다음 중 하나여야 합니다: ${IMAGE_CATEGORIES.join(", ")}`);
    }
    return { results: await this.service.listCandidates(sourceImageId, category as ImageCategory) };
  }

  /** 사용자가 이미지의 선택 상태를 토글 — 한 카테고리에서 여러 장을 선택할 수 있다 */
  @Post("select")
  async selectImage(@Body() body: SelectImageRequest): Promise<ImageDto> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.selectImage(body.imageId);
  }
}
