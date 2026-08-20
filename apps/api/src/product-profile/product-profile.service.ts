import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  applyCrossVerifiedProfile,
  assignStoryImages,
  attachStudioImageCaptions,
  buildLeftoverMediaGallery,
  buildProductFactsPanel,
  buildProductPageViewModel,
  crossVerifyProduct,
  dropRedundantNoticeSections,
  foldLeftoverImagesIntoSections,
  identifyProduct,
  orderStudioImagesForPage,
  parseProductStoryResponse,
  planAuxiliaryVisuals,
  planGenerativeHeroMotif,
  planGenerativeIcons,
  planStoryDesign,
  PRODUCT_STORY_TEMPLATE_KEY,
  ProductProfileEngine,
  ProductProfileExecutionService,
  renderProductProfileHtml,
  renderProductStoryHtml,
  scoreProductStory,
  selectProductPageTemplate,
  selectRepresentativeStudioImages,
  validateProductPageViewModel,
  validateProductStory,
  wrapProductProfileHtmlDocument,
} from "@acos/core";
import type {
  AssignedStorySection,
  AuxiliaryVisualAsset,
  GenerativeVisualAsset,
  GenerativeVisualBundle,
  LeftoverGalleryEntry,
  ProductStoryContext,
  StoryIconId,
  StudioSelectedImage,
  VisionImageInput,
} from "@acos/core";
import type {
  ImageCategory,
  LlmMessageDto,
  ProductPageCopy,
  ProductProfileDto,
  ProductProfileFinalPageDto,
  ProductStoryDto,
  ProductStoryResultDto,
} from "@acos/shared";
import { IMAGE_CATEGORIES } from "@acos/shared";
import type { Prisma, ProductProfile as ProductProfileRecord } from "@prisma/client";
import { ImageGenService } from "../image-gen/image-gen.service";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { LlmService } from "../llm/llm.service";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";
import type { PromptEngine } from "@acos/core";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PrismaProductProfileRunStore } from "./prisma-product-profile-run.store";
import { buildRealDetailCrops } from "./real-photo-crop";

/**
 * Master Creative Brief(T1-153)가 없는 Story(과거 데이터·`masterBrief`를
 * 모르는 테스트 픽스처 등)를 API 응답으로 내보낼 때 쓰는 빈 값 — 없는 것을
 * 지어내지 않고, "이 실행에는 Master Brief가 없다"는 사실을 빈 문자열
 * 그대로 드러낸다.
 */
const EMPTY_MASTER_BRIEF: ProductStoryDto["masterBrief"] = {
  targetAudience: "",
  coreMessage: "",
  emotionalArc: "",
  visualConcept: "",
};

/**
 * 제품 자동 분석(T1-21)·교차 검증(T1-23) 결과를 다시 계산한다. (T1-24)
 *
 * DB에는 STEP 4가 실제로 답한 `profile`만 저장되어 있다 — 별도 컬럼을 두지
 * 않고, `ocrText`·`profile`(둘 다 이미 저장된 스냅샷)로부터 매번 다시
 * 계산한다. `identifyProduct`·`crossVerifyProduct`는 순수 함수라 같은
 * 입력이면 항상 같은 결과이므로, 엔진 실행 시점에 계산한 값과 여기서
 * 다시 계산한 값이 어긋나지 않는다 — 그리고 이 스냅샷 이전에 만들어진
 * 실행 기록에도 그대로 적용된다(별도 마이그레이션·백필이 필요 없다).
 */
/**
 * DB에 저장된 `userRequirementsByCategory`(Json)를 안전하게 읽는다 (T1-99).
 * 값이 없거나(null) 형태가 어긋나면(과거 데이터·수동 조작 등) 빈 값으로
 * 취급한다 — 잘못된 JSON을 그대로 프롬프트에 흘려보내지 않는다.
 */
function normalizeRequirementsByCategory(
  raw: unknown,
): Partial<Record<ImageCategory, string>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const result: Partial<Record<ImageCategory, string>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      (IMAGE_CATEGORIES as readonly string[]).includes(key) &&
      typeof value === "string" &&
      value.trim().length > 0
    ) {
      result[key as ImageCategory] = value.trim();
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function toDto(record: ProductProfileRecord): ProductProfileDto {
  const profile = record.profile as ProductProfileDto["profile"];
  // 이 실행이 근거로 삼을 만한 것(OCR 텍스트든 이미지 특징이든)이 전혀
  // 없으면(예: STEP 3 이전에 실패) 계산하지 않고 null로 둔다 — "찾지
  // 못했다"와 "계산할 근거 자체가 없었다"를 구분한다.
  const hasBasis = Boolean(record.ocrText || record.imageFeatures || profile);
  const identification = hasBasis
    ? identifyProduct({
        ocrText: record.ocrText,
        visionText: record.imageFeatures ? JSON.stringify(record.imageFeatures) : null,
      })
    : null;
  const crossVerification = identification
    ? crossVerifyProduct({ identification, profile })
    : null;
  return {
    id: record.id,
    imageIds: record.imageIds,
    projectId: record.projectId,
    status: record.status,
    ocrText: record.ocrText,
    imageFeatures: record.imageFeatures as ProductProfileDto["imageFeatures"],
    profile,
    identification,
    crossVerification,
    pageCopy: record.pageCopy as ProductProfileDto["pageCopy"],
    html: record.html,
    css: record.css,
    templateKey: record.templateKey,
    userRequirement: record.userRequirement,
    userRequirementsByCategory: normalizeRequirementsByCategory(
      record.userRequirementsByCategory,
    ),
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
    // Product Story 생성 (T1-94) — 이 두 의존성은 `generateStory()`에서만
    // 쓴다. `@Optional()`인 이유: 이 서비스를 직접 `Test.createTestingModule`로
    // 구성하는 기존 단위 테스트들이 이 값을 provider 목록에 넣지 않기
    // 때문이다(다른 메서드는 이 값 없이도 그대로 동작해야 한다).
    @Optional() private readonly llm?: LlmService,
    @Optional() @Inject(PROMPT_ENGINE) private readonly promptEngine?: PromptEngine,
    // Story 보조 그래픽 실 생성 (T1-123) — `generateStory()`에서만 쓴다.
    // `@Optional()`인 이유는 위 llm/promptEngine과 같다: 이 서비스를 직접
    // 구성하는 기존 단위 테스트가 이 provider를 넣지 않아도 다른 메서드는
    // 그대로 동작해야 한다.
    @Optional() private readonly imageGen?: ImageGenService,
  ) {
    this.execution = new ProductProfileExecutionService(engine, store, {
      // 한 실행에 실 LLM 호출이 2건(이미지 분석 + 통합) 묶여 있다. 자동
      // 재시도를 하면 이미 성공한 절반까지 다시 불러 실제 비용이 배로
      // 나간다 — 재시도는 사람이 다시 눌러서 한다 (CTO 결정 1301-①과 같은
      // 판단: 실 호출은 명시적으로만 돈다).
      maxAttempts: 1,
    });
  }

  async run(
    imageIds: string[],
    projectId?: string,
    templateKey?: string,
    userRequirement?: string,
  ): Promise<ProductProfileDto> {
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
    const normalizedTemplateKey = templateKey?.trim() || undefined;
    const normalizedUserRequirement = userRequirement?.trim() || undefined;
    const run = await this.execution.execute(
      {
        imageIds: ids,
        projectId: normalizedProjectId ?? null,
        ocrText: ocrTexts.length > 0 ? ocrTexts.join("\n\n---\n\n") : null,
        templateKey: normalizedTemplateKey ?? null,
        userRequirement: normalizedUserRequirement ?? null,
      },
      {
        images: visionImages,
        ocrTexts,
        projectId: normalizedProjectId,
        templateKey: normalizedTemplateKey,
        userRequirement: normalizedUserRequirement,
      },
    );

    // 실패도 정상 응답이다(OCR·Analysis와 같은 원칙) — status 필드가
    // 사실을 말한다. "실행했지만 실패했다"를 5xx로 감추지 않는다.
    const record = await this.prisma.productProfile.findUniqueOrThrow({
      where: { id: run.id },
    });
    return toDto(record);
  }

  /**
   * 사용자 요구사항만 저장한다 (T1-92) — 실행을 다시 돌리지 않는다(LLM
   * 호출 없음, DB 쓰기 1회). Gemini 이미지 생성은 이 값을 실행마다
   * 다시 읽으므로(`image-gen.service.ts` `findProductPackage`) 바로 다음
   * 생성부터 반영된다. 상세페이지 카피(STEP 5a)에 반영하려면 이 실행을
   * 다시 돌려야 한다(`run()`을 같은 imageIds로 다시 호출) — 여기서는
   * 텍스트만 바꿔 저장한다.
   */
  async updateUserRequirement(
    id: string,
    input: {
      userRequirement?: string | null;
      userRequirementsByCategory?: Partial<Record<ImageCategory, string | null>>;
    },
  ): Promise<ProductProfileDto> {
    const existing = await this.prisma.productProfile.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product Profile을 찾을 수 없습니다: ${id}`);
    }
    const data: Prisma.ProductProfileUpdateInput = {};
    if (input.userRequirement !== undefined) {
      data.userRequirement = input.userRequirement?.trim() || null;
    }
    if (input.userRequirementsByCategory !== undefined) {
      // 부분 갱신 (T1-99) — 보낸 카테고리만 바꾸고 나머지 기존 값은 그대로
      // 남긴다. 값이 빈 문자열/공백/null이면 그 카테고리의 요구사항을
      // 지운다(키 자체를 제거) — 빈 문자열을 그대로 저장하면 나중에 이
      // 카테고리에 요구사항이 "있다"고 잘못 표시된다.
      const current = normalizeRequirementsByCategory(existing.userRequirementsByCategory) ?? {};
      const merged: Partial<Record<ImageCategory, string>> = { ...current };
      for (const [category, value] of Object.entries(input.userRequirementsByCategory)) {
        const trimmed = value?.trim();
        if (trimmed) {
          merged[category as ImageCategory] = trimmed;
        } else {
          delete merged[category as ImageCategory];
        }
      }
      data.userRequirementsByCategory = merged as unknown as Prisma.InputJsonValue;
    }
    const record = await this.prisma.productProfile.update({
      where: { id },
      data,
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

  /**
   * STEP 5 결과를 완전한 HTML 문서로 감싸 반환한다 — 미리보기/다운로드용.
   * 실행이 나중에 다시 열어볼 수 있어야 한다는 요구(Sprint 35 Phase 2)를
   * 충족한다: 저장된 record에서 그대로 재구성하므로 재실행이 필요 없다.
   */
  async getHtmlDocument(id: string): Promise<string> {
    const record = await this.prisma.productProfile.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException(`Product Profile을 찾을 수 없습니다: ${id}`);
    }
    if (!record.html || !record.profile) {
      throw new BadRequestException(
        "이 실행에는 아직 생성된 HTML이 없습니다 (status: " + record.status + ").",
      );
    }
    const profile = record.profile as unknown as ProductProfileDto["profile"];
    return wrapProductProfileHtmlDocument(
      profile!.productName,
      record.html,
      record.css ?? "",
      profile!.keywords,
    );
  }

  /**
   * 최종 상세페이지 (T1-75). Image Studio에서 이 실행이 쓴 원본 사진들에
   * 대해 사람이 카테고리별로 선택해 둔 이미지가 있으면 그것으로 STEP 5b를
   * 다시 조립한다 — LLM을 다시 부르지 않는다(`renderProductProfileHtml`은
   * 순수 함수, `docs/PROJECT_MEMORY.md` "API 비용 최소화" 원칙). 아무것도
   * 선택돼 있지 않으면 STEP 5 실행 시점에 저장된 결과를 그대로 돌려준다 —
   * 재계산해도 같은 값이라 다시 렌더링할 이유가 없다.
   *
   * 제품 동일성 원칙(`docs/MASTER_GUIDE.md` §2): 포장지·라벨·설명서·사양표
   * (`photoType: "INFO"`)는 사람이 실수로 선택했더라도 여기서 한 번 더
   * 걸러 상세페이지 사진으로 쓰지 않는다.
   */
  async getFinalPage(id: string): Promise<ProductProfileFinalPageDto> {
    const record = await this.prisma.productProfile.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException(`Product Profile을 찾을 수 없습니다: ${id}`);
    }
    if (!record.html || !record.profile || !record.pageCopy) {
      throw new BadRequestException(
        "이 실행에는 아직 생성된 상세페이지가 없습니다 (status: " + record.status + ").",
      );
    }
    const profile = record.profile as unknown as ProductProfileDto["profile"];
    const imageFeatures = record.imageFeatures as unknown as ProductProfileDto["imageFeatures"];

    // 캐노니컬 파이프라인 우선 (T1-131 — ④-A/④-B 통합). `POST /:id/story`가
    // 최소 1회 성공해 저장돼 있으면, 카테고리 순서 템플릿(레거시)을 다시
    // 조립하지 않고 그 결과를 그대로 돌려준다. LLM을 다시 부르지 않으므로
    // 추가 비용이 없다 — 저장된 JSON을 읽기만 한다. 레거시 렌더러는 아직
    // Story가 한 번도 생성되지 않은 실행에서만 fallback으로 쓰인다(요청
    // 사양 D-4·D-6: "living-d-proof 같은 레거시 템플릿이 기본값으로 다시
    // 선택되지 않는다").
    if (record.storyResult) {
      const story = record.storyResult as unknown as ProductStoryResultDto;
      const selectedImageCount = story.availableImages.reduce((sum, entry) => sum + entry.count, 0);
      return {
        html: story.html,
        css: story.css,
        templateKey: PRODUCT_STORY_TEMPLATE_KEY,
        productName: story.story.productName,
        keywords: profile?.keywords ?? [],
        imageSource: "studio-selected",
        selectedImageCount,
        source: "story",
        validation: {
          ok: story.validation.ok,
          issues: story.validation.issues.map((issue) => ({
            code: issue.severity,
            message: issue.message,
          })),
        },
      };
    }

    // T1-75 이후 새 실행은 항상 record.templateKey가 채워진다(엔진이 실제로
    // 쓴 값을 markSuccess가 저장한다, T1-77). 이 필드가 비어 있으면 이번
    // 변경 이전에 만들어진 기존 실행 기록이다 — 그때도 하드코딩된
    // "basic" 대신 같은 자동 선택 규칙을 적용해 초기 렌더링과 다른
    // 템플릿으로 갈라지지 않게 한다.
    const templateKey = record.templateKey ?? selectProductPageTemplate(profile!).templateKey;

    const selected = await this.prisma.image.findMany({
      where: {
        sourceImageId: { in: record.imageIds },
        selected: true,
        category: { not: null },
        // `photoType: { not: "INFO" }` 는 SQL NULL 규칙 때문에 photoType이
        // null인 행(Gemini가 생성한 이미지는 분류 자체를 거치지 않아 대부분
        // null이다)을 걸러내 버린다 — 실측으로 확인한 결함(선택된 이미지
        // 3장이 있었는데도 0장으로 보였다). null(=안전한 기본값 DESIGN 취급,
        // Image.photoType 스키마 주석)과 명시적 DESIGN만 허용해 INFO만
        // 정확히 제외한다.
        OR: [{ photoType: null }, { photoType: "DESIGN" }],
      },
      orderBy: [{ groupVersion: "desc" }],
    });

    if (selected.length === 0) {
      return {
        html: record.html,
        css: record.css ?? "",
        templateKey,
        productName: profile!.productName,
        keywords: profile!.keywords,
        imageSource: "original-upload",
        selectedImageCount: 0,
        source: "legacy",
        // 원본 업로드 사진(STEP 5 결과)은 이 시점에 메모리에 다시 올려
        // 두지 않는다 — 검증에 필요한 이미지를 다시 읽으려면 Storage 호출이
        // 추가로 필요해 이 분기(과금 없는 조회 경로)의 성격과 맞지 않는다.
        validation: null,
      };
    }

    // 카테고리별 대표 사진만 남긴다(T1-111) — Image Studio는 재생성마다
    // 이전 선택을 자동 해제하지 않아, 여러 번 다시 만들고 선택하다 보면
    // 같은 카테고리에 사진이 계속 쌓인다(실측: 이 벤치마크 제품은
    // USAGE_SCENE만 11장이 선택된 채로 남아 있었다). 전부 그대로 넣으면
    // "이미지 나열" 구조가 되고, 캡션 없는 사진에 카테고리 라벨을 억지로
    // 붙이던 예전 버그(`attachStudioImageCaptions`, 지금은 제거됨)와
    // 맞물려 같은 문구가 여러 번 반복 노출됐다. DB 조회 순서를 신뢰하지
    // 않고 groupVersion 기준으로 다시 골라 최신 대표/보조 사진만 쓴다.
    const representative = selectRepresentativeStudioImages(
      selected.map((image) => ({
        imageId: image.id,
        category: image.category as unknown as StudioSelectedImage["category"],
        groupVersion: image.groupVersion,
        mimeType: image.mimeType,
        base64: "", // Storage 조회는 대표 선정 뒤에만 한다 — 제외될 사진까지 내려받지 않는다
      })),
    );
    const representativeIds = new Set(representative.map((image) => image.imageId));
    const representativeSelected = selected.filter((image) => representativeIds.has(image.id));

    const bytesList = await Promise.all(
      representativeSelected.map((image) => this.storage.getObject(image.key)),
    );
    const studioImages: StudioSelectedImage[] = representativeSelected.map((image, index) => ({
      imageId: image.id,
      category: image.category as unknown as StudioSelectedImage["category"],
      groupVersion: image.groupVersion,
      mimeType: image.mimeType,
      base64: bytesList[index].toString("base64"),
    }));

    // brand/model은 STEP 4 원본이 아니라 교차 검증된 값을 다시 적용한다 —
    // 최초 렌더링(`ProductProfileEngine`) 때와 정확히 같은 규칙을 쓴다(T1-24).
    const identification = identifyProduct({
      ocrText: record.ocrText,
      visionText: imageFeatures ? JSON.stringify(imageFeatures) : null,
    });
    const crossVerification = crossVerifyProduct({ identification, profile });
    const verifiedProfile = applyCrossVerifiedProfile(profile!, crossVerification);
    const pageCopy = record.pageCopy as unknown as ProductPageCopy;

    // 카테고리(Image Studio가 이미 갖고 있던 사실)를 근거로 사진마다 캡션을
    // 붙인다(T1-93) — 새 LLM 호출 없이, "왜 이 사진이 여기 있는지"를
    // 상세페이지에서 그 사진 옆에 그대로 보여줄 수 있게 한다.
    const orderedImages = attachStudioImageCaptions(
      orderStudioImagesForPage(studioImages),
      verifiedProfile,
      imageFeatures,
    );
    const components = imageFeatures?.components ?? [];
    const { html, css } = renderProductProfileHtml(
      verifiedProfile,
      components,
      pageCopy,
      orderedImages,
      templateKey,
    );
    // 최종 렌더링이 실제 제품 정보·이미지와 맞는지 검사한다(T1-77 요구사항
    // 11). LLM 호출 없음 — 이미 만든 vm을 그대로 검사만 한다.
    const vm = buildProductPageViewModel(verifiedProfile, components, pageCopy, orderedImages);
    const validation = validateProductPageViewModel(vm, verifiedProfile, orderedImages);

    return {
      html,
      css,
      templateKey,
      productName: verifiedProfile.productName,
      keywords: verifiedProfile.keywords,
      imageSource: "studio-selected",
      selectedImageCount: representativeSelected.length,
      source: "legacy",
      validation,
    };
  }

  /** 최종 상세페이지를 완전한 HTML 문서로 감싼다 — 미리보기/다운로드용 */
  async getFinalHtmlDocument(id: string): Promise<string> {
    const page = await this.getFinalPage(id);
    return wrapProductProfileHtmlDocument(page.productName, page.html, page.css, page.keywords);
  }

  /**
   * Image Studio에서 사람이 선택(검증)해 둔 실제 제품 이미지를 모은다.
   * `getFinalPage()`가 쓰는 쿼리와 같은 규칙(선택됨 + 카테고리 있음 +
   * INFO 제외)이다 — 그 메서드를 그대로 재사용하지 않고 따로 둔 이유는,
   * 이 작업(T1-94)이 진행되는 동안 `getFinalPage()`가 다른 작업(T1-93)에
   * 의해 동시에 계속 수정되고 있어 같은 메서드를 함께 고치면 충돌
   * 위험이 컸기 때문이다(`docs/PROJECT_MEMORY.md`가 기록한 동시 진행
   * 세션 충돌과 같은 종류의 위험, T1-24가 `product-package.ts`를 피한
   * 것과 같은 판단).
   */
  private async loadSelectedDesignImages(imageIds: string[]): Promise<StudioSelectedImage[]> {
    // `sourceImageId: { in: imageIds }`는 Gemini가 만든 파생 이미지만
    // 잡는다 — 실제 업로드 원본 자체(kind=ORIGINAL)는 자기 자신이
    // sourceImageId를 갖지 않으므로 `id: { in: imageIds }`로 함께
    // 조회해야 한다(T1-144 — `selectOriginalAsAsset`으로 카테고리가
    // 지정된 원본을 이 목록에 실제로 포함시키기 위함).
    const selected = await this.prisma.image.findMany({
      where: {
        AND: [
          { OR: [{ sourceImageId: { in: imageIds } }, { id: { in: imageIds } }] },
          { OR: [{ photoType: null }, { photoType: "DESIGN" }] },
        ],
        selected: true,
        category: { not: null },
      },
      orderBy: [{ groupVersion: "desc" }],
    });
    const bytesList = await Promise.all(selected.map((image) => this.storage.getObject(image.key)));
    const base: StudioSelectedImage[] = selected.map((image, index) => ({
      imageId: image.id,
      category: image.category as unknown as StudioSelectedImage["category"],
      groupVersion: image.groupVersion,
      mimeType: image.mimeType,
      base64: bytesList[index].toString("base64"),
      source: image.kind === "ORIGINAL" ? "real" : "generated",
    }));
    const trimmed = await this.autoTrimIsolatedProducts(base);
    return this.withRealDetailCrops(trimmed);
  }

  /**
   * 고립형(화이트 배경) 제품 단독 사진의 `imageRole`만 분류한다 — 실제
   * crop(`autoTrimIsolatedProductImage`, `product-isolated-auto-trim.ts`)은
   * canonical render path(final-html)에서 **끈다** (T1-168). T1-166이 이
   * 경로를 켰다가 제품 사진이 이상하게 잘리는 회귀가 발견되어(요청 사양
   * "제품 사진을 잘라서 해결하지 않는다"), 안전성을 우선해 T1-165처럼
   * 원본 이미지 sizing을 그대로 쓰는 쪽으로 되돌렸다. auto-trim 로직
   * 자체(`product-isolated-auto-trim.ts`와 그 테스트)는 지우지 않았다 —
   * 다시 켤 때는 이 함수 안에서만 배선하면 된다.
   */
  private async autoTrimIsolatedProducts(images: StudioSelectedImage[]): Promise<StudioSelectedImage[]> {
    return images.map((image) => ({
      ...image,
      imageRole: image.category === "USAGE_SCENE" ? "lifestyle" : "product-isolated",
    }));
  }

  /**
   * 실제 원본 사진(source: "real")마다 순수 crop 최대 2장을 추가한다
   * (T1-144 요청 사양 4 — "제품 디테일 crop/zoom asset을 추가해 12개
   * 이상으로 확장"). Gemini를 부르지 않는다 — 같은 픽셀을 잘라 확대만
   * 하므로 새 사실을 지어내지 않는다(`real-photo-crop.ts` 참고). crop
   * 실패(손상된 이미지 등)는 조용히 생략한다 — 원본 자체는 이미 목록에
   * 그대로 있으므로 crop이 없다고 전체가 실패하지 않는다.
   */
  private async withRealDetailCrops(images: StudioSelectedImage[]): Promise<StudioSelectedImage[]> {
    const result: StudioSelectedImage[] = [...images];
    for (const image of images) {
      if (image.source !== "real") continue;
      const buffer = Buffer.from(image.base64, "base64");
      const crops = await buildRealDetailCrops(buffer, image.mimeType);
      crops.forEach((crop, index) => {
        result.push({
          imageId: `${image.imageId}::crop-${index + 1}`,
          category: image.category,
          groupVersion: image.groupVersion,
          mimeType: crop.mimeType,
          base64: crop.base64,
          source: "real",
          imageRole: image.imageRole,
        });
      });
    }
    return result;
  }

  /**
   * Product Story 생성 (T1-94). 상세페이지 생성의 핵심 개념을 "제품의
   * 스토리를 만드는 것"으로 재정의한 정식 단계다 — Product Profile(교차
   * 검증된 사실) + Image Studio에서 사람이 이미 선택(검증)한 실제 제품
   * 이미지의 카테고리 현황 + 사용자 요구사항을 근거로, 실 LLM 호출 1건으로
   * 하나의 일관된 서사(Product Story)와 그 서사를 구성하는 동적 Story
   * Section들을 만든다. 그 다음 순수 함수(LLM 호출 없음)로 각 섹션에
   * 실제 이미지를 배정하고, HTML/CSS로 조립하고, 기계적 품질 검사를
   * 돌린다.
   *
   * **생성 자체는 여전히 매번 실 LLM 비용이 발생한다** — 다시 만들고
   * 싶으면 이 메서드를 다시 호출해야 하고, 호출자는 그 사실을 알아야
   * 한다. 다만 T1-131부터는 **결과를 `ProductProfile.storyResult`에
   * 캐시로 저장한다** — ④-A/④-B를 하나의 캐노니컬 파이프라인으로
   * 합치면서, `/final`·`/final-html`이 매번 이 메서드를 다시 부르지
   * 않고도(추가 비용 없이) 마지막으로 승인된 Story 결과를 최종
   * 상세페이지로 서빙할 수 있어야 하기 때문이다. 저장은 best-effort다
   * — 실패해도 이번 응답 자체는 그대로 반환한다(다음 `/final` 조회가
   * 레거시로 fallback할 뿐).
   *
   * 검증된 실제 제품 이미지가 하나도 선택되어 있지 않으면 진행하지
   * 않는다 — "선택 실제 제품 이미지"가 이 단계의 필수 입력이라는
   * 요청 사양을 따른다(원본 업로드 사진만으로 대체하지 않는다).
   */
  async generateStory(id: string, userRequirementOverride?: string | null): Promise<ProductStoryResultDto> {
    if (!this.llm || !this.promptEngine) {
      throw new BadRequestException("Product Story 생성에 필요한 LLM 연결이 준비되지 않았습니다.");
    }
    const record = await this.prisma.productProfile.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Product Profile을 찾을 수 없습니다: ${id}`);
    }
    if (!record.profile) {
      throw new BadRequestException(
        "이 실행에는 아직 검증된 Product Profile이 없습니다 (status: " + record.status + ").",
      );
    }
    const profile = record.profile as unknown as ProductProfileDto["profile"];
    const imageFeatures = record.imageFeatures as unknown as ProductProfileDto["imageFeatures"];
    const identification = identifyProduct({
      ocrText: record.ocrText,
      visionText: imageFeatures ? JSON.stringify(imageFeatures) : null,
    });
    const crossVerification = crossVerifyProduct({ identification, profile });
    const verifiedProfile = applyCrossVerifiedProfile(profile!, crossVerification);

    const availableImages = await this.loadSelectedDesignImages(record.imageIds);
    if (availableImages.length === 0) {
      throw new BadRequestException(
        "Image Studio에서 선택(검증)된 실제 제품 이미지가 없습니다 — Product Story는 검증된 실제 이미지를 전제로 생성됩니다. 먼저 이미지를 선택하세요.",
      );
    }
    const categoryCounts = new Map<ImageCategory, number>();
    for (const image of availableImages) {
      categoryCounts.set(image.category, (categoryCounts.get(image.category) ?? 0) + 1);
    }
    const availableImageSummary = [...categoryCounts.entries()].map(([category, count]) => ({ category, count }));

    const userRequirement =
      userRequirementOverride !== undefined ? userRequirementOverride : record.userRequirement;
    // 목적(카테고리)별 요구사항(T1-99)을 Story 프롬프트에도 연결한다
    // (T1-147) — 지금까지는 Gemini 이미지 생성에만 쓰이고 Story(카피·
    // 섹션 우선순위)에는 전달되지 않았다.
    const userRequirementsByCategory = normalizeRequirementsByCategory(record.userRequirementsByCategory);

    const context: ProductStoryContext = {
      profile: verifiedProfile,
      productPackage: verifiedProfile,
      availableImages: availableImageSummary,
      userRequirement,
      userRequirementsByCategory,
    };
    const baseMessages = this.promptEngine.render(PRODUCT_STORY_TEMPLATE_KEY, context);
    const availableCategories = availableImageSummary.map((item) => item.category);

    // Copywriter — 가능하면 Claude(Anthropic)를 우선 검토한다 (T1-97 요청
    // 사양). 이 환경에 ANTHROPIC_API_KEY가 없으면(2026-08-12 로컬 .env
    // 실측 — 없음) undefined로 두어 기존 라우팅/기본 Provider(openai)로
    // 그대로 진행한다 — 없는 Provider를 강제해 호출을 실패시키지 않는다.
    const preferredProvider = process.env.ANTHROPIC_API_KEY ? "anthropic" : undefined;

    // Quality Critic이 fail(70점 미만)로 판정하면 Story Planner/Copywriter
    // 단계로 한 번만 되돌려 재생성한다(요청 사양) — 비용을 통제하기 위해
    // 무한 재시도가 아니라 딱 1회로 제한한다.
    const MAX_ATTEMPTS = 2;
    let messages: LlmMessageDto[] = baseMessages;
    let attempts = 0;
    let story!: ReturnType<typeof parseProductStoryResponse>;
    let assigned!: AssignedStorySection[];
    let designPlan!: ReturnType<typeof planStoryDesign>;
    let mediaGallery!: LeftoverGalleryEntry[];
    let rendered!: ReturnType<typeof renderProductStoryHtml>;
    let validation!: ReturnType<typeof validateProductStory>;
    let quality!: ReturnType<typeof scoreProductStory>;
    let completion!: Awaited<ReturnType<LlmService["complete"]>>;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      await this.budget?.assertWithinBudget({ what: "Product Story 생성 (Gemini/GPT)" });
      completion = await this.llm.complete(
        { messages, responseFormat: "json", maxTokens: 4096 },
        {
          feature: "product-profile-story",
          projectId: record.projectId ?? undefined,
          ...(preferredProvider ? { provider: preferredProvider } : {}),
        },
      );

      story = parseProductStoryResponse(completion.text, availableCategories);
      // 주의사항/보증 섹션은 여기서 걸러낸다(T1-147) — 아래 `buildProductFactsPanel`이
      // 검증된 값으로 같은 내용을 페이지 맨 아래에 항상 한 번 붙이므로,
      // LLM이 만든 별도 주의사항 섹션을 그대로 두면 페이지에 두 번 나타난다.
      story = dropRedundantNoticeSections(story);
      assigned = assignStoryImages(story, availableImages);
      // 디자인(레이아웃·타이포그래피·아이콘·강조색)은 LLM이 아니라 이 결정적
      // 함수가 정한다 — Story Section의 이미 검증된 필드에서만 도출한다
      // (T1-112, "누가 무엇을 결정하는가": 카피=LLM, 디자인=이 파이프라인).
      designPlan = planStoryDesign(story);
      // 어느 섹션에도 배정되지 못한 선택 이미지는 별도 "제품 더 보기"
      // 섹션 대신, 같은 카테고리를 쓰는 섹션의 갤러리로 합친다(T1-147 —
      // 레퍼런스 시안에는 별도 회수 섹션이 없다). 이후 재렌더링(생성형
      // 자산 반영)에서도 같은 값을 그대로 재사용한다 — 이미지 배정 자체는
      // 여기서 이미 끝났다.
      mediaGallery = buildLeftoverMediaGallery(assigned, availableImages);
      assigned = foldLeftoverImagesIntoSections(assigned, mediaGallery);
      rendered = renderProductStoryHtml(story, assigned, designPlan);
      // designPlan·html을 함께 넘겨 "Design Plan과 실제 HTML의 일치도"까지
      // 검사한다(T1-112) — 렌더러가 Design Plan을 무시해도 여기서 잡힌다.
      validation = validateProductStory(story, assigned, verifiedProfile, userRequirement, designPlan, rendered.html);
      quality = scoreProductStory(validation, designPlan);

      if (quality.grade !== "fail" || attempt === MAX_ATTEMPTS) {
        break;
      }
      const feedbackLines = [
        "방금 만든 Story가 자동 품질 검사에서 낮은 점수를 받았다 — 같은 JSON 형식으로 " +
          "다시 만들되 아래에 지적된 문제를 실제로 고쳐서 다시 출력해줘. 문제를 피하려고 " +
          "문장만 살짝 바꾸지 말고, 근거·표현 자체를 다시 검토해줘.",
        ...validation.issues
          .filter((issue) => issue.severity === "block")
          .map((issue) => `- [${issue.code}] ${issue.message}`),
      ];
      messages = [...baseMessages, { role: "user", content: feedbackLines.join("\n") }];
    }

    // Gemini 보조 그래픽 실 생성 (T1-123) — 실제 제품 사진이 없는 섹션에만,
    // 계획된 만큼만(`MAX_AUXILIARY_VISUALS`=2) 실제로 호출한다. `imageGen`이
    // 없는 환경(단위 테스트 등)이거나 계획 자체가 비어 있으면(모든 섹션에
    // 이미 실제 사진이 있는 등) 아무 호출도 하지 않는다 — "비용을 이유로
    // 생략하지 않는다"는 요청 사양은 "필요한 곳에는 반드시 쓴다"는 뜻이지
    // "필요 없는 곳에도 쓴다"는 뜻이 아니다.
    const auxiliarySpecs = planAuxiliaryVisuals(story, assigned, designPlan);
    const auxiliaryVisualReport: ProductStoryResultDto["auxiliaryVisuals"] = [];
    const auxiliaryGeneratedAssets: AuxiliaryVisualAsset[] = [];
    if (auxiliarySpecs.length > 0 && this.imageGen) {
      for (const spec of auxiliarySpecs) {
        try {
          const result = await this.imageGen.generateAuxiliaryVisual(spec.promptText);
          auxiliaryGeneratedAssets.push({
            sectionId: spec.sectionId,
            role: spec.role,
            source: "gemini-auxiliary",
            mimeType: result.mimeType,
            base64: result.imageBytes,
          });
          auxiliaryVisualReport.push({
            sectionId: spec.sectionId,
            role: spec.role,
            generated: true,
            reason: spec.reason,
          });
        } catch (error) {
          // 실패해도 전체 Story 생성을 막지 않는다 — 그 섹션은 그냥 보조
          // 그래픽 없이 렌더링된다(텍스트·실제 제품 사진 경로는 이 실패와
          // 무관하다). 실패 사실 자체는 감추지 않고 보고에 남긴다.
          auxiliaryVisualReport.push({
            sectionId: spec.sectionId,
            role: spec.role,
            generated: false,
            reason: error instanceof Error ? error.message : "알 수 없는 오류",
          });
        }
      }
    } else if (auxiliarySpecs.length > 0) {
      for (const spec of auxiliarySpecs) {
        auxiliaryVisualReport.push({
          sectionId: spec.sectionId,
          role: spec.role,
          generated: false,
          reason: "이미지 생성 서비스가 연결되지 않아 시도하지 않았습니다.",
        });
      }
    }

    // 생성형 아이콘/Hero 타이포그래피 모티프 실 생성 (T1-142) — 위 보조
    // 그래픽(섹션별 배경 장식)과는 목적이 다른 두 번째 종류의 생성형 자산.
    // 이번 Story가 실제로 쓰는 아이콘만(중복 없이, 최대 6종) + Hero 모티프
    // 1개만 시도한다 — "필요한 곳에는 반드시 쓰되 필요 없는 곳에는 쓰지
    // 않는다"는 auxiliaryVisuals와 같은 비용 원칙.
    const iconSpecs = planGenerativeIcons(designPlan);
    const motifSpec = planGenerativeHeroMotif(story);
    const generativeVisualReport: ProductStoryResultDto["generativeVisuals"] = [];
    const generativeIconAssets: Partial<Record<StoryIconId, GenerativeVisualAsset>> = {};
    let heroMotifAsset: GenerativeVisualAsset | null = null;
    if (this.imageGen) {
      for (const spec of iconSpecs) {
        try {
          const result = await this.imageGen.generateDesignAsset(spec.promptText);
          generativeIconAssets[spec.id] = {
            kind: "ICON",
            id: spec.id,
            source: "gemini-generative-design",
            mimeType: result.mimeType,
            base64: result.imageBytes,
          };
          generativeVisualReport.push({ kind: spec.kind, id: spec.id, generated: true, reason: spec.reason });
        } catch (error) {
          // 실패해도 렌더러가 기존 인라인 SVG 아이콘으로 되돌아간다 —
          // 전체 Story 생성을 막지 않는다(auxiliaryVisuals와 같은 원칙).
          generativeVisualReport.push({
            kind: spec.kind,
            id: spec.id,
            generated: false,
            reason: error instanceof Error ? error.message : "알 수 없는 오류",
          });
        }
      }
      if (motifSpec) {
        try {
          const result = await this.imageGen.generateDesignAsset(motifSpec.promptText);
          heroMotifAsset = {
            kind: "HERO_MOTIF",
            id: motifSpec.id,
            source: "gemini-generative-design",
            mimeType: result.mimeType,
            base64: result.imageBytes,
          };
          generativeVisualReport.push({ kind: motifSpec.kind, id: motifSpec.id, generated: true, reason: motifSpec.reason });
        } catch (error) {
          generativeVisualReport.push({
            kind: motifSpec.kind,
            id: motifSpec.id,
            generated: false,
            reason: error instanceof Error ? error.message : "알 수 없는 오류",
          });
        }
      }
    } else {
      for (const spec of iconSpecs) {
        generativeVisualReport.push({
          kind: spec.kind,
          id: spec.id,
          generated: false,
          reason: "이미지 생성 서비스가 연결되지 않아 시도하지 않았습니다.",
        });
      }
      if (motifSpec) {
        generativeVisualReport.push({
          kind: motifSpec.kind,
          id: motifSpec.id,
          generated: false,
          reason: "이미지 생성 서비스가 연결되지 않아 시도하지 않았습니다.",
        });
      }
    }

    // 보조 그래픽·생성형 아이콘/모티프 중 하나라도 실제로 생성됐으면
    // 그 결과를 반영해 딱 한 번만 다시 렌더링한다(순수 함수라 비용 없음
    // — 실 과금은 위 Gemini 호출들에서 이미 끝났다).
    if (auxiliaryGeneratedAssets.length > 0 || Object.keys(generativeIconAssets).length > 0 || heroMotifAsset) {
      const generativeVisuals: GenerativeVisualBundle = { icons: generativeIconAssets, heroMotif: heroMotifAsset };
      rendered = renderProductStoryHtml(story, assigned, designPlan, auxiliaryGeneratedAssets, generativeVisuals);
    }

    // 제품 정보/법정 표시 패널 (T1-139) — Story Section의 productFacts는
    // LLM이 "이 사실을 쓸지 말지" 스스로 고르므로, 재질·규격·원산지·
    // 구성품·주의사항처럼 구매 판단에 필요한 사실은 LLM의 선택에 맡기지
    // 않고 검증된 값에서 결정적으로 렌더링해 최종 페이지 뒤에 항상
    // 붙인다(`renderProductStoryHtml` 자체는 고치지 않는다 — T1-138과
    // 같은 파일을 동시에 고치지 않기 위한 의도적 분리,
    // `product-story-facts-panel.ts` 상단 주석 참고). 표시할 값이 하나도
    // 없으면(모든 필드 미확인) null — 빈 패널을 억지로 붙이지 않는다.
    const factsPanel = buildProductFactsPanel({
      profile: verifiedProfile,
      identification,
      components: imageFeatures?.components ?? [],
    });
    if (factsPanel) {
      rendered = {
        html: rendered.html + factsPanel.html,
        css: `${rendered.css}\n${factsPanel.css}`,
      };
    }

    // 최종 페이지에 실제로 쓰인 시각 asset 수 집계 (T1-144, T1-147에서
    // 갱신). 남은 이미지는 이제 별도 "제품 더 보기" 섹션이 아니라
    // `foldLeftoverImagesIntoSections`가 이미 `assigned[i].gallery`로
    // 합쳐 놓았으므로, `assigned` 한 곳만 세면 실제로 렌더링된 장수와
    // 정확히 일치한다 — 카테고리가 맞지 않아 폴드되지 못하고 버려진
    // 이미지(`mediaGallery`에는 남아 있지만 `assigned`에는 없는 것)는
    // 화면에 없으므로 "실제로 쓰인" 집계에도 넣지 않는다.
    const usedImages = new Map<string, StudioSelectedImage>();
    for (const item of assigned) {
      if (item.image) usedImages.set(item.image.imageId, item.image);
      for (const galleryImage of item.gallery ?? []) usedImages.set(galleryImage.imageId, galleryImage);
    }
    const byCategory: Partial<Record<ImageCategory, number>> = {};
    let realProductPhotos = 0;
    let generativeProductVisuals = 0;
    for (const image of usedImages.values()) {
      byCategory[image.category] = (byCategory[image.category] ?? 0) + 1;
      if ((image.source ?? "generated") === "real") realProductPhotos += 1;
      else generativeProductVisuals += 1;
    }
    const generativeDesignAssets =
      Object.keys(generativeIconAssets).length + (heroMotifAsset ? 1 : 0);

    const result: ProductStoryResultDto = {
      story: {
        productName: story.productName,
        narrativeSummary: story.narrativeSummary,
        masterBrief: story.masterBrief ?? EMPTY_MASTER_BRIEF,
        sections: story.sections.map((section, index) => ({
          ...section,
          assignedImageId: assigned[index]?.image?.imageId ?? null,
        })),
      },
      html: rendered.html,
      css: rendered.css,
      designPlan,
      validation,
      quality,
      attempts,
      availableImages: availableImageSummary,
      auxiliaryVisuals: auxiliaryVisualReport,
      generativeVisuals: generativeVisualReport,
      provider: completion.provider,
      model: completion.model,
      assetInventory: {
        realProductPhotos,
        generativeProductVisuals,
        generativeDesignAssets,
        totalVisualAssets: realProductPhotos + generativeProductVisuals + generativeDesignAssets,
        byCategory,
      },
    };

    // 캐노니컬 파이프라인 캐시 저장 (T1-131). best-effort — 저장이 실패해도
    // 이번 호출의 응답(result)은 그대로 사용자에게 돌아간다.
    try {
      await this.prisma.productProfile.update({
        where: { id },
        data: {
          storyResult: result as unknown as Prisma.InputJsonValue,
          storyGeneratedAt: new Date(),
        },
      });
    } catch {
      // 다음 `/final` 조회는 저장된 값이 없으니 레거시로 fallback한다 —
      // 이 실행 자체가 실패한 것은 아니므로 예외를 다시 던지지 않는다.
    }

    return result;
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
