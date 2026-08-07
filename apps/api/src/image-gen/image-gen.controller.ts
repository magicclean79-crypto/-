import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import type {
  CompositeImageRequest,
  GenerateBackgroundRequest,
  GenerateHeroImageRequest,
  GenerateHeroImageResult,
  ImageDto,
} from "@acos/shared";
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
}
