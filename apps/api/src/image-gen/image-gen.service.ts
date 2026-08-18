import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { buildImageGenerationPrompt, buildProductPackage, type ImageEditProvider } from "@acos/core";
import type {
  GenerateHeroImageResult,
  GenerateImageCandidatesResult,
  GenerateUsageShotsResult,
  ImageCategory,
  ImageDto,
  ProductPackage,
} from "@acos/shared";
import type { Image, Prisma } from "@prisma/client";
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
    category: image.category as ImageDto["category"],
    groupVersion: image.groupVersion,
    style: image.style,
    selected: image.selected,
    photoType: image.photoType as ImageDto["photoType"],
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
  private readonly logger = new Logger(ImageGenService.name);

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

  /**
   * 포장지·라벨·설명서·사양표(INFO)로 분류된 사진은 Gemini에 절대 보내지
   * 않는다. (T1-26 — CTO 지시) `generateImageCandidates`에만 이 검사가
   * 있었는데, `removeBackground`·`generateBackground`·`composite`는
   * imageId를 그대로 받아 바로 Provider에 넘겨 이 규칙을 우회할 수 있었다
   * — Gemini로 가는 모든 진입점에서 공통으로 막는다.
   */
  private assertNotInfoImage(image: Image): void {
    if (image.photoType === "INFO") {
      throw new BadRequestException(
        "이 사진은 정보 확인용(포장지·라벨·스펙표)으로 분류되어 이미지 생성에 쓸 수 없습니다. " +
          "제품이 찍힌 사진을 선택해 주세요.",
      );
    }
  }

  /**
   * 원본 이미지가 속한 Product Profile을 찾아 Product Package로 조립한다.
   * (CTO 지시, 2026-08-08 — GPT → Product Package → Gemini 연결 1단계)
   *
   * `Image`↔`ProductProfile` 사이에 FK가 없다(ProductProfile.imageIds는
   * 감사용 스칼라 배열) — 같은 원본 이미지로 여러 번 실행됐으면 가장 최근
   * 실행을 쓴다. Product Profile이 없으면 조용히 빈 Package로 넘어가지
   * 않고 명확히 실패한다 — GPT 단계가 먼저 끝나야 Gemini가 의미 있는
   * Package를 받을 수 있다.
   *
   * `category`(선택, T1-99) — 지정하면 그 카테고리(생성 목적)의 요구사항이
   * 있는지 함께 확인해 우선 적용한다. `findProductPackage` 참고.
   */
  private async getProductPackage(
    sourceImageId: string,
    category?: ImageCategory,
  ): Promise<ProductPackage> {
    const found = await this.findProductPackage(sourceImageId, category);
    if (!found) {
      throw new BadRequestException(
        "먼저 이 사진으로 Product Profile을 생성해야 이미지를 생성할 수 있습니다.",
      );
    }
    return found;
  }

  /**
   * 있으면 쓰고 없으면 null — 배경 제거·배경 생성·합성처럼 Product Profile
   * 없이도 돌아야 하는 단계용이다. 이 단계들까지 프로필을 요구하면 예전에
   * 되던 흐름이 갑자기 막힌다. 대신 프로필이 있으면 그 정보를 함께 넘겨
   * 제품의 형태·재질이 더 정확하게 유지되도록 한다.
   *
   * `category`(선택, T1-99) — 카테고리별(대표 썸네일/디테일샷/사용 장면/
   * 구성품 등) Gemini 이미지 생성 요구사항. 값이 있으면 범용
   * `userRequirement`(T1-92) 대신 이 값을 쓴다 — 목적마다 다른 요구사항을
   * 독립적으로 반영하기 위함이다(예: 대표 썸네일은 "배경을 화이트로",
   * 구성품은 "패킹까지 전부 보이게" 처럼 서로 다른 지시가 같은 프롬프트에
   * 섞이지 않는다). 해당 카테고리에 값이 없으면 범용 값으로 폴백한다
   * (하위 호환 — 아직 목적별 입력을 쓰지 않는 실행은 예전과 동일하게
   * 동작한다).
   */
  private async findProductPackage(
    sourceImageId: string,
    category?: ImageCategory,
  ): Promise<ProductPackage | null> {
    const record = await this.prisma.productProfile.findFirst({
      where: { imageIds: { has: sourceImageId } },
      orderBy: { updatedAt: "desc" },
    });
    if (!record) {
      return null;
    }
    const categoryRequirement = category
      ? readRequirementForCategory(record.userRequirementsByCategory, category)
      : null;
    return buildProductPackage({
      profile: record.profile as ProductPackage["productProfile"],
      ocrText: record.ocrText,
      // Vision 분석 결과도 식별에 함께 쓴다 (T1-21, 2026-08-09).
      // OCR이 우선이며, Vision은 OCR이 못 읽은 것만 보완한다.
      visionText: record.imageFeatures ? JSON.stringify(record.imageFeatures) : null,
      // 사용자 요구사항 기반 생성 (T1-92, 목적별 우선은 T1-99) — Image
      // Studio에서 저장한 값을 그대로 실어 보낸다. `PATCH
      // /product-profile/:id/user-requirement`로 재생성 없이 값만 바꿀 수
      // 있으므로, 매번 이 실행 레코드에서 다시 읽는다(스냅샷을 따로 두지
      // 않는다).
      userRequirement: categoryRequirement ?? record.userRequirement,
    });
  }

  private async storeResult(options: {
    imageBytes: string;
    mimeType: string;
    kind: "BACKGROUND_REMOVED" | "BACKGROUND_GENERATED" | "COMPOSITED";
    sourceImageId: string;
    prompt: string;
    model: string;
    backgroundImageId?: string;
    shotIndex?: number;
    category?: ImageCategory;
    groupVersion?: number;
    style?: string;
    productPackage?: ProductPackage | null;
    rawResponseText?: string | null;
    referenceImages?: { id: string; role: string; photoType?: "DESIGN" | "INFO" | null }[];
    excludedInfoImages?: { id: string; originalName: string }[];
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
        category: options.category,
        groupVersion: options.groupVersion,
        style: options.style,
        generationMetadata: {
          prompt: options.prompt,
          provider: this.provider.name,
          model: options.model,
          ...(options.backgroundImageId ? { backgroundImageId: options.backgroundImageId } : {}),
          ...(options.shotIndex !== undefined ? { shotIndex: options.shotIndex } : {}),
          ...(options.productPackage ? { productPackage: options.productPackage } : {}),
          ...(options.rawResponseText ? { rawResponseText: options.rawResponseText } : {}),
          ...(options.referenceImages ? { referenceImages: options.referenceImages } : {}),
          ...(options.excludedInfoImages
            ? { excludedInfoImages: options.excludedInfoImages }
            : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return toDto(record);
  }

  /** 제품 사진에서 배경을 제거한다 — 결과는 kind=BACKGROUND_REMOVED 새 이미지로 저장 */
  async removeBackground(imageId: string, productPackage?: ProductPackage | null): Promise<ImageDto> {
    const source = await this.getImage(imageId);
    this.assertNotInfoImage(source);
    const pkg = productPackage ?? (await this.findProductPackage(imageId));
    await this.budget?.assertWithinBudget({ what: "이미지 배경 제거 (Gemini)" });
    const bytes = await this.storage.getObject(source.key);
    const prompt = buildImageGenerationPrompt(
      pkg,
      "이 제품 사진에서 제품만 남기고 배경을 완전히 제거해서 깨끗한 흰색 배경으로 바꿔줘. " +
        "제품의 형태와 색상, 비율은 그대로 유지해.",
    );
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
      productPackage: pkg,
      rawResponseText: result.text,
    });
  }

  /** 제품과 어울리는 배경 이미지를 새로 생성한다(제품은 포함하지 않음) */
  async generateBackground(
    sourceImageId: string,
    backgroundPrompt: string,
    productPackage?: ProductPackage | null,
  ): Promise<ImageDto> {
    const trimmed = backgroundPrompt?.trim();
    if (!trimmed) {
      throw new BadRequestException("prompt는 필수입니다.");
    }
    const source = await this.getImage(sourceImageId);
    this.assertNotInfoImage(source);
    const pkg = productPackage ?? (await this.findProductPackage(sourceImageId));
    await this.budget?.assertWithinBudget({ what: "이미지 배경 생성 (Gemini)" });
    const prompt = buildImageGenerationPrompt(
      pkg,
      `${trimmed} 제품 자체는 이미지에 넣지 말고 배경만 만들어줘.`,
    );
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
      productPackage: pkg,
      rawResponseText: result.text,
    });
  }

  /** 배경이 제거된 제품 이미지를 생성된 배경 위에 합성한다 */
  async composite(
    productImageId: string,
    backgroundImageId: string,
    productPackage?: ProductPackage | null,
  ): Promise<ImageDto> {
    const [product, background] = await Promise.all([
      this.getImage(productImageId),
      this.getImage(backgroundImageId),
    ]);
    this.assertNotInfoImage(product);
    this.assertNotInfoImage(background);
    const pkg =
      productPackage ?? (await this.findProductPackage(product.sourceImageId ?? product.id));
    await this.budget?.assertWithinBudget({ what: "이미지 합성 (Gemini)" });
    const prompt = buildImageGenerationPrompt(
      pkg,
      "첫 번째 이미지(배경이 제거된 제품)를 두 번째 이미지(배경) 위에 자연스럽게 합성해줘. " +
        "그림자와 조명을 배경에 맞게 보정해줘.",
    );
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
      productPackage: pkg,
      rawResponseText: result.text,
    });
  }

  /**
   * Product Story 섹션 보조 그래픽(추상 배경/강조 아트) 생성. (T1-123)
   *
   * `product-story-auxiliary-visual.ts`(T1-112)가 이미 계획(어느 섹션에
   * 왜 필요한지)과 프롬프트 문장까지 순수 함수로 만들어 두고 "실제 호출은
   * 하지 않는다"고 의도적으로 비워 둔 자리를 이 메서드가 채운다.
   *
   * 실제 제품 사진이 아니라 텍스트 전용 섹션을 보완하는 추상 장식이므로
   * **참조 이미지 없이(0장) 순수 텍스트→이미지로 생성한다** — `promptText`
   * 자체에 이미 "제품 실물·사람·글자를 그리지 말라"는 금지 지시가 들어
   * 있고(`buildAuxiliaryVisualPrompt`), 실제 제품 사진을 참조로 주면
   * 오히려 그 형태를 베껴 그릴 위험이 생긴다. INFO(포장지·라벨·사양표)
   * 사진은 물론 DESIGN 사진조차 이 경로에서는 아예 참조하지 않으므로,
   * "OCR/INFO 사진을 생성 참조로 쓰지 않는다"는 원칙이 위반될 여지 자체가
   * 없다.
   *
   * DB에 저장하지 않는다 — `ProductProfileService.generateStory()`와 같은
   * 무상태 원칙(호출마다 다시 생성, 다시 과금)을 따른다.
   */
  async generateAuxiliaryVisual(
    promptText: string,
  ): Promise<{ imageBytes: string; mimeType: string; provider: string; model: string }> {
    return this.generatePromptOnlyDesignAsset(promptText, "상세페이지 보조 그래픽 생성 (Gemini)");
  }

  /**
   * Story 전체가 공유하는 생성형 아이콘/Hero 타이포그래피 모티프 생성.
   * (T1-142)
   *
   * `product-story-generative-visuals.ts`가 계획(어느 아이콘·모티프가
   * 필요한지, 프롬프트 문장)까지 순수 함수로 만들고 "실제 호출은 하지
   * 않는다"고 비워 둔 자리를 채운다 — `generateAuxiliaryVisual`과 정확히
   * 같은 형태의 호출(참조 이미지 없이 텍스트→이미지, 예산 게이트)이라
   * 내부 구현을 공유하고 예산 사유 문구만 다르게 남겨 어떤 목적으로 얼마나
   * 호출됐는지 예산 로그에서 구분할 수 있게 한다.
   */
  async generateDesignAsset(
    promptText: string,
  ): Promise<{ imageBytes: string; mimeType: string; provider: string; model: string }> {
    return this.generatePromptOnlyDesignAsset(promptText, "상세페이지 생성형 타이포그래피/아이콘 자산 생성 (Gemini)");
  }

  private async generatePromptOnlyDesignAsset(
    promptText: string,
    budgetReason: string,
  ): Promise<{ imageBytes: string; mimeType: string; provider: string; model: string }> {
    await this.budget?.assertWithinBudget({ what: budgetReason });
    const result = await this.provider.edit({ prompt: promptText, images: [] });
    return {
      imageBytes: result.imageBytes,
      mimeType: result.mimeType,
      provider: this.provider.name,
      model: result.model,
    };
  }

  /**
   * 배경 제거 → 배경 생성 → 합성을 한 번에 실행하는 Hero 이미지 파이프라인.
   *
   * Product Package를 **한 번만 조회해 세 단계에 그대로 넘긴다** (CTO 지시,
   * 2026-08-08 — Sprint 1 규칙 1). 단계마다 다시 조회하면 도중에 프로필이
   * 갱신됐을 때 한 장 안에서 서로 다른 제품 정보가 섞인다.
   */
  async generateHero(imageId: string, backgroundPrompt?: string): Promise<GenerateHeroImageResult> {
    const original = await this.getImage(imageId);
    const productPackage = await this.getProductPackage(imageId);
    const backgroundRemoved = await this.removeBackground(imageId, productPackage);
    const backgroundGenerated = await this.generateBackground(
      imageId,
      backgroundPrompt?.trim() ||
        "이 제품이 실제로 쓰이는 자연스러운 생활 공간 배경을 만들어줘 — 밝고 깨끗한 실내 또는 실외 공간.",
      productPackage,
    );
    const composited = await this.composite(
      backgroundRemoved.id,
      backgroundGenerated.id,
      productPackage,
    );
    return {
      original: toDto(original),
      backgroundRemoved,
      backgroundGenerated,
      composited,
    };
  }

  /**
   * 실사용 장면 여러 샷 생성. (CTO 실측 확인, 2026-08-08 — "베란다 청소하는
   * 모습 합성 실행시 제품이 잘보이도록 원거리 근거리샷으로 3~4장 생성으로
   * 하니깐 어느정도 괜찮은 샷이 나왔다") 정적으로 배경에 얹는 단일 합성보다
   * "실제 사용하는 모습"을 원거리·근거리 여러 컷으로 한 번에 뽑아서 그중
   * 고르는 방식이 결과가 더 좋다는 것이 실측으로 확인됐다 — 배경 제거한
   * 제품 사진 1장 + 카메라 거리별 지시만 다른 프롬프트로 Gemini를 여러 번
   * 호출한다. 한 샷이 실패해도 나머지는 그대로 보여준다.
   */
  async generateUsageShots(
    imageId: string,
    scenePrompt: string | undefined,
    shotCount: number | undefined,
  ): Promise<GenerateUsageShotsResult> {
    const scene = scenePrompt?.trim() || "이 제품이 실제로 사용되는 자연스러운 모습";
    const count = Math.min(6, Math.max(1, shotCount ?? 4));
    const original = await this.getImage(imageId);
    const productPackage = await this.getProductPackage(imageId);
    const backgroundRemoved = await this.removeBackground(imageId, productPackage);
    const bgRemovedImage = await this.getImage(backgroundRemoved.id);
    const bytes = await this.storage.getObject(bgRemovedImage.key);

    const shots: ImageDto[] = [];
    let failedCount = 0;
    for (let i = 0; i < count; i++) {
      const framing = USAGE_SHOT_FRAMINGS[i % USAGE_SHOT_FRAMINGS.length];
      const prompt = buildImageGenerationPrompt(
        productPackage,
        `${scene}. ${framing} 사진처럼 자연스럽고 사실적으로 만들어줘.`,
      );
      try {
        await this.budget?.assertWithinBudget({ what: `이미지 사용 장면 생성 (Gemini, ${i + 1}/${count})` });
        const result = await this.provider.edit({
          prompt,
          images: [{ mimeType: bgRemovedImage.mimeType, base64: bytes.toString("base64") }],
        });
        const dto = await this.storeResult({
          imageBytes: result.imageBytes,
          mimeType: result.mimeType,
          kind: "COMPOSITED",
          sourceImageId: original.id,
          prompt,
          model: result.model,
          shotIndex: i,
          category: "USAGE_SCENE",
          productPackage,
          rawResponseText: result.text,
        });
        shots.push(dto);
      } catch {
        failedCount++;
      }
    }

    return { original: toDto(original), backgroundRemoved, shots, failedCount };
  }

  /** 배경 제거 결과가 이미 있으면 재사용하고, 없으면 새로 만든다 — 카테고리마다
   * 매번 배경을 다시 지우면 호출이 낭비된다. */
  private async getOrCreateBackgroundRemoved(
    imageId: string,
    productPackage?: ProductPackage | null,
  ): Promise<Image> {
    const existing = await this.prisma.image.findFirst({
      where: { sourceImageId: imageId, kind: "BACKGROUND_REMOVED" },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return existing;
    }
    const created = await this.removeBackground(imageId, productPackage);
    return this.getImage(created.id);
  }

  /**
   * 카테고리별(Hero/사용장면/디테일/특징강조/구성품/기타) 이미지 후보 여러
   * 버전 생성. (CTO 지시, 2026-08-08 — "AI 상세페이지 제작 플랫폼") 같은
   * 소스+카테고리로 재생성해도 이전 버전을 지우지 않고 `groupVersion`을
   * 1씩 늘려 새로 쌓는다 — 사용자가 언제든 이전 버전으로 돌아갈 수 있다.
   */
  async generateImageCandidates(
    imageId: string,
    category: ImageCategory,
    options: { count?: number; style?: string; scenePrompt?: string; storySectionPurpose?: string },
  ): Promise<GenerateImageCandidatesResult> {
    const count = Math.min(6, Math.max(1, options.count ?? 4));
    const original = await this.getImage(imageId);
    // 포장지·라벨을 원본으로 골라 생성하면 Gemini가 포장 디자인을 제품으로
    // 그린다. (CTO 지시, 2026-08-08 — 입력 분리) 조용히 넘어가지 않고 막는다.
    this.assertNotInfoImage(original);
    const productPackage = await this.getProductPackage(imageId, category);
    const bgRemovedImage = await this.getOrCreateBackgroundRemoved(imageId, productPackage);
    const backgroundRemoved = toDto(bgRemovedImage);

    const lastVersion = await this.prisma.image.findFirst({
      where: { sourceImageId: imageId, category },
      orderBy: { groupVersion: "desc" },
      select: { groupVersion: true },
    });
    const groupVersion = (lastVersion?.groupVersion ?? 0) + 1;

    const baseInstruction = options.scenePrompt?.trim() || CATEGORY_PROMPTS[category];
    const styleSuffix = options.style?.trim() ? ` 스타일 방향: ${options.style.trim()}.` : "";
    // Product Story 연결 (T1-94, 선택) — 이 이미지가 상세페이지의 어느
    // Story Section 역할을 하는지 참고로 덧붙인다. 제품 동일성 규칙보다
    // 뒤에 붙는 지시문 안에서만 쓰이므로, 실제 제품 사실과 충돌하는
    // 요청으로 제품 자체가 바뀌지는 않는다(buildImageGenerationPrompt의
    // 기존 우선순위 규칙 — 제품 동일성 > 제품 정보 > 이 지시문).
    const storySuffix = options.storySectionPurpose?.trim()
      ? ` 이 사진은 상세페이지에서 "${options.storySectionPurpose.trim()}" 역할을 하는 섹션에 쓰인다 — 그 역할에 맞는 장면으로 만들어줘.`
      : "";

    // 참고 사진을 **여러 장** 보낸다. (CTO 지시, 2026-08-08 — 제품 동일성 개선)
    //
    // 배경 제거본만 보내면 Gemini가 색상·질감·디테일의 근거를 잃고, 그
    // 빈자리를 상상으로 채워 **다른 제품**을 그린다(실측 확인). 대표 사진
    // 한 장만으로도 구성품과 뒷면 디테일은 알 수 없다.
    //
    // 그래서 같은 프로젝트의 다른 제품 사진(구성품·디테일)도 함께 넘긴다.
    // 순서가 의미를 가진다 — 프롬프트가 "첫 번째는 윤곽, 두 번째는 기준"이라고
    // 설명하므로 배경 제거본·원본을 반드시 앞 두 자리에 둔다.
    //
    // **INFO 사진은 절대 넘기지 않는다.** (CTO 지시, 2026-08-08 — 입력 분리)
    // 포장지·라벨·스펙표·설명서·바코드는 정보를 뽑기 위한 문서이지 제품
    // 사진이 아니다. 이것을 Gemini에 보내면 포장 디자인을 제품의 일부로
    // 착각해 그린다. Gemini가 받아야 하는 것은 그 문서에서 뽑아낸 **정제된
    // 정보**(Product Package)이지 문서 이미지가 아니다.
    //
    // 분류는 Product Profile 실행 시 AI가 자동으로 한다(DESIGN/INFO).
    // 아직 분류되지 않은 사진(null)은 제품 사진인지 알 수 없으므로 넘기지
    // 않는다 — 모르는 것을 통과시키지 않는다.
    const extraImages = await this.prisma.image.findMany({
      where: {
        projectId: original.projectId,
        kind: "ORIGINAL",
        id: { not: original.id },
        photoType: "DESIGN",
      },
      orderBy: { createdAt: "asc" },
      take: MAX_EXTRA_REFERENCE_IMAGES,
    });

    // 전달하지 않은 INFO 사진 목록 — 화면에서 "OCR 전용"으로 보여 준다.
    const excludedInfoImages = await this.prisma.image.findMany({
      where: { projectId: original.projectId, kind: "ORIGINAL", photoType: "INFO" },
      orderBy: { createdAt: "asc" },
      select: { id: true, originalName: true },
    });

    const [bgRemovedBytes, originalBytes, ...extraBytes] = await Promise.all([
      this.storage.getObject(bgRemovedImage.key),
      this.storage.getObject(original.key),
      ...extraImages.map((image) => this.storage.getObject(image.key)),
    ]);
    const referenceImages = [
      { mimeType: bgRemovedImage.mimeType, base64: bgRemovedBytes.toString("base64") },
      { mimeType: original.mimeType, base64: originalBytes.toString("base64") },
      ...extraImages.map((image, index) => ({
        mimeType: image.mimeType,
        base64: (extraBytes[index] as Buffer).toString("base64"),
      })),
    ];

    // 사람이 화면에서 확인할 수 있도록 "무엇을 보냈는지"를 남긴다.
    const referenceImageList = [
      { id: bgRemovedImage.id, role: "배경 제거본 (윤곽 기준)", photoType: null },
      {
        id: original.id,
        role: "원본 대표 사진 (색상·재질·디테일 기준)",
        photoType: original.photoType as "DESIGN" | "INFO" | null,
      },
      ...extraImages.map((image) => ({
        id: image.id,
        role: "같은 제품의 다른 사진 (구성품·각도)",
        photoType: image.photoType as "DESIGN" | "INFO" | null,
      })),
    ];

    const candidates: ImageDto[] = [];
    let failedCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < count; i++) {
      const framing = CANDIDATE_FRAMINGS[i % CANDIDATE_FRAMINGS.length];
      const extraNote =
        extraImages.length > 0
          ? `세 번째 이후 이미지(${extraImages.length}장)는 같은 제품의 다른 사진이다 — 구성품·뒷면·디테일 확인용. `
          : "";
      const instruction =
        `${baseInstruction}${styleSuffix} ${framing} 사진처럼 자연스럽고 사실적으로 만들어줘. ` +
        "첫 번째 이미지는 배경을 지운 제품(윤곽 기준), 두 번째 이미지는 원본 사진(색상·재질·질감·디테일 기준)이다. " +
        extraNote +
        "제공된 이미지는 모두 같은 하나의 제품이며, 생성 결과도 반드시 그 제품이어야 한다." +
        storySuffix;
      const prompt = buildImageGenerationPrompt(productPackage, instruction);
      try {
        await this.budget?.assertWithinBudget({
          what: `이미지 후보 생성 (Gemini, ${category} v${groupVersion} ${i + 1}/${count})`,
        });
        const result = await this.provider.edit({
          prompt,
          images: referenceImages,
        });
        const dto = await this.storeResult({
          imageBytes: result.imageBytes,
          mimeType: result.mimeType,
          kind: "COMPOSITED",
          sourceImageId: original.id,
          prompt,
          model: result.model,
          shotIndex: i,
          category,
          groupVersion,
          style: options.style?.trim() || undefined,
          productPackage,
          rawResponseText: result.text,
          referenceImages: referenceImageList,
          excludedInfoImages,
        });
        candidates.push(dto);
      } catch (error) {
        failedCount++;
        // 실패를 조용히 삼키지 않는다 — 무인 실행에서 가장 위험한 것은
        // "실패가 성공처럼 보이는 것"이다(PROJECT_MEMORY M-26). 서버
        // 로그와 API 응답 양쪽에 원인을 남겨, 호출한 쪽(Image Studio·이
        // 검증 자체)이 "생성 0장인데 왜인지 모른다"는 상태에 빠지지 않게
        // 한다(T1-136/T1-138 — Gemini 생성이 화면에 안 보이는 문제의
        // 근본 원인 중 하나가 이 catch였다).
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `이미지 후보 생성 실패 (category=${category}, v${groupVersion}, ${i + 1}/${count}): ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        errors.push(message);
      }
    }

    return { original: toDto(original), backgroundRemoved, category, groupVersion, candidates, failedCount, errors };
  }

  /** 특정 원본 사진의 한 카테고리에 대해 지금까지 생성된 모든 버전을 최신순으로 돌려준다 */
  async listCandidates(sourceImageId: string, category: ImageCategory): Promise<ImageDto[]> {
    const records = await this.prisma.image.findMany({
      where: { sourceImageId, category },
      orderBy: [{ groupVersion: "desc" }, { createdAt: "asc" }],
    });
    return records.map(toDto);
  }

  /**
   * 이 이미지의 선택 상태를 토글한다. (CTO 지시, 2026-08-08 — 한 카테고리에서
   * 여러 장을 동시에 선택할 수 있어야 한다) 예전에는 하나를 고르면 같은
   * 카테고리의 나머지가 자동으로 선택 해제됐다 — 상세페이지에 여러 장을
   * 같이 쓰는 경우(예: 특징 강조 이미지 여러 컷)를 표현할 수 없었다. 이제는
   * 다른 이미지를 건드리지 않고 이 이미지만 켜고 끈다.
   */
  async selectImage(imageId: string): Promise<ImageDto> {
    const image = await this.getImage(imageId);
    if (!image.category || !image.sourceImageId) {
      throw new BadRequestException("카테고리가 없는 이미지는 선택할 수 없습니다.");
    }
    const updated = await this.prisma.image.update({
      where: { id: imageId },
      data: { selected: !image.selected },
    });
    return toDto(updated);
  }

  /**
   * 실제 업로드 원본 사진을 (Gemini 호출 없이) 그대로 상세페이지의 한
   * 카테고리 asset으로 지정한다. (T1-144 — 이미지 밀도 확대)
   *
   * 기존 흐름은 원본을 항상 "생성 참조"로만 쓰고, 상세페이지에 실제로
   * 쓰이는 건 Gemini가 새로 그린 결과(`category`/`selected`가 붙는 대상)
   * 뿐이었다 — 실제 원본 사진 자체는 최종 페이지에 등장할 방법이 없었다.
   * 요청 사양(T1-144)이 "최소 4~6개는 실제 검증된 제품 원본 사진"을
   * 요구하므로, 이미 사람이 업로드해 검증한 원본을 그대로 그 카테고리의
   * asset으로 쓸 수 있는 경로를 연다 — 새 픽셀을 만들지 않으므로 비용도
   * 없고 제품 동일성 위험도 없다(원본 그 자체이므로).
   */
  async selectOriginalAsAsset(imageId: string, category: ImageCategory): Promise<ImageDto> {
    const image = await this.getImage(imageId);
    if (image.kind !== "ORIGINAL") {
      throw new BadRequestException(
        "실제 업로드 원본 사진만 이 방식으로 카테고리를 지정할 수 있습니다. Gemini가 만든 이미지는 기존 select 엔드포인트를 쓰세요.",
      );
    }
    this.assertNotInfoImage(image);
    const updated = await this.prisma.image.update({
      where: { id: imageId },
      data: { category, selected: true },
    });
    return toDto(updated);
  }

  /**
   * 지정한 id들의 이미지 메타데이터를 조회한다 (T1-99) — Image Studio가
   * "제품 시각 참조용(DESIGN)"과 "상품 분석 전용(INFO)"을 구분해 보여줄
   * 때 쓴다. 없는 id는 조용히 결과에서 빠진다(존재하는 것만 보여주면
   * 충분하고, 하나가 없다고 나머지 조회까지 막을 이유가 없다).
   */
  async getImagesByIds(ids: string[]): Promise<ImageDto[]> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (unique.length === 0) {
      return [];
    }
    const images = await this.prisma.image.findMany({ where: { id: { in: unique } } });
    return images.map(toDto);
  }
}

/**
 * `ProductProfile.userRequirementsByCategory`(Json)에서 특정 카테고리의
 * 요구사항만 안전하게 읽는다 (T1-99). 저장 형태가 예상과 다르면(과거
 * 데이터·수동 조작 등) null로 취급한다 — 잘못된 값을 프롬프트에 그대로
 * 흘려보내지 않는다.
 */
function readRequirementForCategory(raw: unknown, category: ImageCategory): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const value = (raw as Record<string, unknown>)[category];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 배경 제거본·원본 외에 추가로 넘기는 참고 사진 수의 상한.
 * (CTO 지시, 2026-08-08 — 제품 동일성 개선)
 *
 * 제품 동일성을 위해 구성품·디테일 사진도 넘기지만, 무한정 넘기면 호출당
 * 비용과 시간이 함께 늘어난다. 벤치마크(7장) 기준으로 대표 사진을 뺀
 * 나머지를 담을 수 있는 크기로 둔다.
 */
const MAX_EXTRA_REFERENCE_IMAGES = 6;

/** 카메라 거리별 지시 — 실측(2026-08-08)으로 확인된 "원거리/근거리 여러 컷" 조합 */
const USAGE_SHOT_FRAMINGS = [
  "원거리 와이드샷 — 공간 전체와 제품, 사용하는 사람이 함께 보이도록.",
  "중간 거리 샷 — 사람이 제품을 사용하는 동작이 잘 보이도록.",
  "근접 사용 장면 — 제품과 손, 사용 동작을 크게 보이도록.",
  "클로즈업 — 제품 디테일과 사용 순간이 선명하게 보이도록.",
];

/** 카테고리 후보 생성용 카메라 거리 변주(사용 장면과 별개 — Hero/디테일/구성품 등도 재사용) */
const CANDIDATE_FRAMINGS = [
  "원거리 와이드샷.",
  "중간 거리 샷.",
  "근접 샷.",
  "클로즈업.",
];

/** 카테고리별 기본 생성 프롬프트 (AI 상세페이지 제작 플랫폼, 2026-08-08) */
const CATEGORY_PROMPTS: Record<ImageCategory, string> = {
  HERO: "이 제품의 대표 Hero 이미지를 만들어줘 — 제품이 가장 매력적으로 보이는 각도와 조명, 제품과 어울리는 배경.",
  USAGE_SCENE: "이 제품이 실제로 사용되는 자연스러운 모습을 보여주는 장면을 만들어줘.",
  DETAIL: "이 제품의 재질과 디테일이 잘 보이는 클로즈업 사진을 만들어줘 — 표면 질감과 마감 처리가 선명하게 보이도록.",
  FEATURE_HIGHLIGHT: "이 제품의 핵심 기능이 시각적으로 강조되어 보이는 이미지를 만들어줘.",
  COMPONENTS: "이 제품의 구성품을 깔끔하게 펼쳐놓은 플랫레이 사진을 만들어줘.",
  OTHER: "이 제품의 상세페이지에 필요한 보조 이미지를 만들어줘(사용방법, 사이즈 비교, 인포그래픽 등).",
};
