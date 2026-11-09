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
  GetImagesByIdsResponse,
  ImageCategory,
  ImageDto,
  SelectImageRequest,
  SelectOriginalAsAssetRequest,
} from "@acos/shared";
import { IMAGE_CATEGORIES } from "@acos/shared";
import { Public } from "../auth/write-protection.guard";
import { ImageGenService } from "./image-gen.service";

/**
 * 이미지 생성/편집. (Sprint 36 — Gemini 배경 제거·배경 생성·제품 합성)
 * 실 Gemini 호출 1건당 과금 발생. 각 엔드포인트는 개별 단계이고,
 * `/image-gen/hero`는 세 단계를 한 번에 실행한다.
 *
 * 이 컨트롤러 전체는 `/image-studio` 화면 전용 API다(다른 화면은 호출하지
 * 않음, T1-90 조사로 확인). Image Studio는 로그인 없이 바로 쓸 수 있어야
 * 한다는 정책(T1-90)에 따라 모든 쓰기 엔드포인트를 `@Public()`으로 표시한다
 * — 전역 `WriteProtectionGuard`(기본 EDITOR 이상 요구)를 이 컨트롤러에서만
 * 우회하는 것이며, 다른 모듈(Product Profile 등)의 쓰기 보호는 그대로
 * 유지된다.
 */
@Controller("image-gen")
export class ImageGenController {
  constructor(private readonly service: ImageGenService) {}

  @Post("remove-background")
  @Public()
  async removeBackground(@Body() body: { imageId?: string }): Promise<ImageDto> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.removeBackground(body.imageId);
  }

  @Post("generate-background")
  @Public()
  async generateBackground(@Body() body: GenerateBackgroundRequest): Promise<ImageDto> {
    if (!body?.sourceImageId) {
      throw new BadRequestException("sourceImageId는 필수입니다.");
    }
    return this.service.generateBackground(body.sourceImageId, body.prompt);
  }

  @Post("composite")
  @Public()
  async composite(@Body() body: CompositeImageRequest): Promise<ImageDto> {
    if (!body?.productImageId || !body?.backgroundImageId) {
      throw new BadRequestException("productImageId, backgroundImageId는 필수입니다.");
    }
    return this.service.composite(body.productImageId, body.backgroundImageId);
  }

  /** 배경 제거 → 배경 생성 → 합성을 한 번에 실행 */
  @Post("hero")
  @Public()
  async generateHero(@Body() body: GenerateHeroImageRequest): Promise<GenerateHeroImageResult> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.generateHero(body.imageId, body.backgroundPrompt);
  }

  /** 실사용 장면 여러 샷 생성(원거리/근거리) — CTO 실측으로 확인된 방식(2026-08-08) */
  @Post("usage-shots")
  @Public()
  async generateUsageShots(@Body() body: GenerateUsageShotsRequest): Promise<GenerateUsageShotsResult> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.generateUsageShots(body.imageId, body.scenePrompt, body.shotCount);
  }

  /** 카테고리별(Hero/사용장면/디테일/특징강조/구성품/기타) 이미지 후보 여러 버전 생성 */
  @Post("candidates")
  @Public()
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
      storySectionPurpose: body.storySectionPurpose,
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
  @Public()
  async selectImage(@Body() body: SelectImageRequest): Promise<ImageDto> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    return this.service.selectImage(body.imageId);
  }

  /**
   * 실제 업로드 원본 사진을 Gemini 호출 없이 그대로 상세페이지 asset
   * 카테고리로 지정한다(T1-144 — 이미지 밀도 확대, "최소 4~6개는 실제
   * 원본 사진" 요구사항). 비용 없음.
   */
  @Post("select-original")
  @Public()
  async selectOriginalAsAsset(@Body() body: SelectOriginalAsAssetRequest): Promise<ImageDto> {
    if (!body?.imageId) {
      throw new BadRequestException("imageId는 필수입니다.");
    }
    if (!body?.category || !IMAGE_CATEGORIES.includes(body.category)) {
      throw new BadRequestException(`category는 다음 중 하나여야 합니다: ${IMAGE_CATEGORIES.join(", ")}`);
    }
    return this.service.selectOriginalAsAsset(body.imageId, body.category);
  }

  /**
   * 지정한 id들의 이미지 메타데이터(photoType 포함) 조회 (T1-99) — Image
   * Studio가 참조 사진 선택 화면에서 "제품 시각 참조용(DESIGN)"과 "상품
   * 분석 전용(INFO)"을 구분해 보여주는 데 쓴다. 읽기 전용이라 다른
   * GET 엔드포인트와 마찬가지로 `@Public()`을 붙이지 않는다(쓰기
   * 전역가드는 GET에는 적용되지 않는다, T1-90).
   */
  @Get("images")
  async getImages(@Query("ids") ids?: string): Promise<GetImagesByIdsResponse> {
    if (!ids?.trim()) {
      throw new BadRequestException("ids는 필수입니다(쉼표로 구분).");
    }
    const list = ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
    return { results: await this.service.getImagesByIds(list) };
  }
}
