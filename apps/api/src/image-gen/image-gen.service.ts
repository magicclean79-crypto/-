import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
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
   */
  private async getProductPackage(sourceImageId: string): Promise<ProductPackage> {
    const found = await this.findProductPackage(sourceImageId);
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
   */
  private async findProductPackage(sourceImageId: string): Promise<ProductPackage | null> {
    const record = await this.prisma.productProfile.findFirst({
      where: { imageIds: { has: sourceImageId } },
      orderBy: { updatedAt: "desc" },
    });
    if (!record) {
      return null;
    }
    return buildProductPackage({
      profile: record.profile as ProductPackage["productProfile"],
      ocrText: record.ocrText,
      // Vision 분석 결과도 식별에 함께 쓴다 (T1-21, 2026-08-09).
      // OCR이 우선이며, Vision은 OCR이 못 읽은 것만 보완한다.
      visionText: record.imageFeatures ? JSON.stringify(record.imageFeatures) : null,
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
    options: { count?: number; style?: string; scenePrompt?: string },
  ): Promise<GenerateImageCandidatesResult> {
    const count = Math.min(6, Math.max(1, options.count ?? 4));
    const original = await this.getImage(imageId);
    // 포장지·라벨을 원본으로 골라 생성하면 Gemini가 포장 디자인을 제품으로
    // 그린다. (CTO 지시, 2026-08-08 — 입력 분리) 조용히 넘어가지 않고 막는다.
    this.assertNotInfoImage(original);
    const productPackage = await this.getProductPackage(imageId);
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
        "제공된 이미지는 모두 같은 하나의 제품이며, 생성 결과도 반드시 그 제품이어야 한다.";
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
      } catch {
        failedCount++;
      }
    }

    return { original: toDto(original), backgroundRemoved, category, groupVersion, candidates, failedCount };
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
