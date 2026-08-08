import type { LlmImageDto, LlmMessageDto, LlmResponseFormat, PhotoType, ProductPageCopy } from "@acos/shared";
import type { PromptEngine } from "../prompt/prompt-engine";
import { PRODUCT_FEATURE_VISION_TEMPLATE_KEY } from "../prompt/templates/product-feature-vision.template";
import { PRODUCT_PAGE_COPY_TEMPLATE_KEY } from "../prompt/templates/product-page-copy.template";
import { PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY } from "../prompt/templates/product-profile-synthesis.template";
import {
  DEFAULT_IMAGE_GUARD_POLICY,
  ImageGuardError,
  validateSourceImage,
  type ImageGuardPolicy,
  type ImagePreprocessor,
} from "../vision/image-guard";
import type { VisionImageInput } from "../vision/vision-provider";
import {
  parseImageFeatureAnalysisResponse,
  type ImageFeatureAnalysis,
  type ImageFeatureAnalysisContext,
} from "./image-feature-analysis";
import { parseProductPageCopyResponse, type ProductPageCopyContext } from "./product-page-copy";
import { renderProductProfileHtml } from "./product-page-html";
import {
  parseProductProfileResponse,
  type ProductProfile,
  type ProductProfileSynthesisContext,
} from "./product-profile";

/** LLM Gateway 호출 함수 (Port) — apps/api에서는 LlmService가 어댑터가 된다 */
export type ProductProfileLlmClient = (request: {
  messages: LlmMessageDto[];
  images: LlmImageDto[];
  responseFormat: LlmResponseFormat;
  /** 어느 단계 호출인지 — Execution feature 태깅용 */
  step: "vision" | "synthesis" | "copy";
  /** 배정 주체 프로젝트 (TASK-1101 Sticky Assignment) — 없으면 무상태 */
  projectId?: string;
}) => Promise<{ provider: string; model: string; text: string }>;

export interface ProductProfileEngineOptions {
  promptEngine: PromptEngine;
  complete: ProductProfileLlmClient;
  /** 뒤에 있는 LLM Provider 이름 (예: "mock", "openai") — 이력 식별용 */
  llmProviderName: string;
  /** 첨부 이미지 수 상한 (기본 5, 최소 1) */
  maxImages?: number;
  imagePreprocessor?: ImagePreprocessor;
  imagePolicy?: ImageGuardPolicy;
}

export interface ProductProfileEngineInput {
  images: VisionImageInput[];
  /** 참고용 OCR 텍스트 */
  ocrTexts: string[];
  projectId?: string;
  /** STEP 5b HTML 렌더링에 쓸 템플릿 — 미지정 시 BASIC(기본형) */
  templateKey?: string;
}

export interface ProductProfileEngineResult {
  imageFeatures: ImageFeatureAnalysis;
  profile: ProductProfile;
  pageCopy: ProductPageCopy;
  html: string;
  css: string;
  /** 사진 유형 자동 분류 결과(CTO 지시, 2026-08-08) — 어떤 원본 이미지 id가
   * DESIGN/INFO로 분류됐는지. 호출자(apps/api)가 이걸로 Image.photoType을
   * 저장한다. Image Guard에서 걸러진 이미지는 여기 없다(분석 자체를 못 함). */
  photoTypeByImageId: { imageId: string; photoType: PhotoType }[];
  raw: {
    provider: string;
    vision: { provider: string; model: string; responseText: string };
    synthesis: { provider: string; model: string; responseText: string };
    copy: { provider: string; model: string; responseText: string };
    imageCount: number;
    omittedImageCount: number;
    skippedImages: { id: string; reason: string }[];
  };
}

const DEFAULT_MAX_IMAGES = 5;

/**
 * Product Detail Engine V1 — STEP 3(이미지 특징 분석) + STEP 4(Profile
 * 통합) 오케스트레이터. (TASK-5601, Sprint 35 — CTO 지시 "Sprint 35 Phase 1")
 *
 * `LlmVisionProvider`(TASK-0505)와 같은 원칙(Image Guard, 이미지 상한,
 * 첨부 실패 이미지는 스킵)을 따르되 Company Brain·Project 의존이 없다 —
 * "사진만 넣으면"이 V1의 전제이기 때문이다. 기존 vision-analysis /
 * product-analysis 파이프라인은 건드리지 않고 병행한다.
 *
 * STEP 3은 이미지를 직접 보고(멀티모달) 재질·색상·구조·용도·구성품을
 * 뽑는다. STEP 4는 그 결과 + OCR 텍스트만으로(이미지 재첨부 없음) 최종
 * Product Profile을 통합한다 — 이미지 판단은 STEP 3이 끝냈으므로 STEP 4가
 * 다시 보면 같은 사실에 두 개의 답이 생길 수 있다.
 *
 * STEP 5(Sprint 35 Phase 2)는 두 단계로 나뉜다: (a) Product Profile만
 * 근거로 대표 문구·제품 설명을 LLM으로 생성하고(이미지 재첨부 없음 —
 * STEP 4와 같은 원칙), (b) 그 결과를 Product Profile·STEP 3 구성품과
 * 함께 **LLM 없이 결정적으로** HTML/CSS로 렌더링한다(`renderProductProfileHtml`,
 * 순수 함수) — 마크업 조립에는 새 사실 판단이 필요 없어 LLM 호출을 하나
 * 더 늘릴 이유가 없다.
 *
 * 실패 시 reject — 재시도/폴백은 호출자(apps/api ProductProfileService)가
 * 담당한다.
 */
export class ProductProfileEngine {
  /** 이력 식별용 — OcrRunStore.start(..., provider.name)과 같은 원칙 */
  readonly name: string;
  private readonly maxImages: number;
  private readonly imagePolicy: ImageGuardPolicy;

  constructor(private readonly options: ProductProfileEngineOptions) {
    this.name = `llm:${options.llmProviderName}`;
    this.maxImages = Math.max(
      1,
      Math.floor(options.maxImages ?? DEFAULT_MAX_IMAGES),
    );
    this.imagePolicy = options.imagePolicy ?? DEFAULT_IMAGE_GUARD_POLICY;
  }

  async run(
    input: ProductProfileEngineInput,
  ): Promise<ProductProfileEngineResult> {
    const attachedImages = input.images.slice(0, this.maxImages);
    const images: LlmImageDto[] = [];
    // images와 같은 순서로 쌍을 이룬다 — Image Guard에서 걸러진 사진은 여기 없다
    const retainedImageIds: string[] = [];
    const skippedImages: { id: string; reason: string }[] = [];
    for (const image of attachedImages) {
      const source = {
        mimeType: image.mimeType,
        bytes: await image.getBytes(),
      };
      try {
        validateSourceImage(source, this.imagePolicy);
        const prepared = this.options.imagePreprocessor
          ? await this.options.imagePreprocessor.prepare(
              source,
              this.imagePolicy,
            )
          : source;
        images.push({
          mimeType: prepared.mimeType,
          base64: Buffer.from(prepared.bytes).toString("base64"),
        });
        retainedImageIds.push(image.id);
      } catch (error) {
        if (!(error instanceof ImageGuardError)) {
          throw error;
        }
        skippedImages.push({ id: image.id, reason: error.message });
      }
    }

    // STEP 3 — 이미지 특징 분석 (멀티모달)
    const featureContext: ImageFeatureAnalysisContext = {
      ocrTexts: input.ocrTexts,
      imageCount: images.length,
    };
    const featureMessages = this.options.promptEngine.render(
      PRODUCT_FEATURE_VISION_TEMPLATE_KEY,
      featureContext,
    );
    const featureCompletion = await this.options.complete({
      messages: featureMessages,
      images,
      responseFormat: "json",
      step: "vision",
      projectId: input.projectId,
    });
    const imageFeatures = parseImageFeatureAnalysisResponse(
      featureCompletion.text,
      images.length,
    );

    // 사진 유형 자동 분류 (CTO 지시, 2026-08-08 — 최우선 기능): INFO 사진(라벨/
    // 스펙표/설명서 등)은 정보 추출이 끝나면 즉시 작업 대상에서 제외한다 —
    // STEP 5b(HTML) 렌더링에도, 나중에 Gemini 이미지 생성에도 전달하지 않는다.
    const photoTypeByImageId = retainedImageIds.map((imageId, index) => ({
      imageId,
      photoType: imageFeatures.photoTypes[index] ?? "DESIGN",
    }));
    const designImages = images.filter(
      (_, index) => imageFeatures.photoTypes[index] !== "INFO",
    );

    // STEP 4 — Product Profile 통합 (텍스트 전용, 이미지 재첨부 없음)
    const synthesisContext: ProductProfileSynthesisContext = {
      ocrTexts: input.ocrTexts,
      imageFeatures,
      imageCount: images.length,
    };
    const synthesisMessages = this.options.promptEngine.render(
      PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY,
      synthesisContext,
    );
    const synthesisCompletion = await this.options.complete({
      messages: synthesisMessages,
      images: [],
      responseFormat: "json",
      step: "synthesis",
      projectId: input.projectId,
    });
    const profile = parseProductProfileResponse(synthesisCompletion.text);

    // STEP 5a — 상세페이지 카피 생성 (텍스트 전용, Profile만 근거)
    const copyContext: ProductPageCopyContext = { profile };
    const copyMessages = this.options.promptEngine.render(
      PRODUCT_PAGE_COPY_TEMPLATE_KEY,
      copyContext,
    );
    const copyCompletion = await this.options.complete({
      messages: copyMessages,
      images: [],
      responseFormat: "json",
      step: "copy",
      projectId: input.projectId,
    });
    const pageCopy = parseProductPageCopyResponse(copyCompletion.text);

    // STEP 5b — HTML/CSS 렌더링 (LLM 호출 없음, 결정적)
    // 실제 업로드 사진(이미 Image Guard·리사이즈를 통과한 것)을 그대로
    // Hero·특징 카드에 심는다 — "텍스트 생성"이 아니라 사진을 쓰는 상세페이지가
    // 되려면 STEP 3이 분석한 그 사진이 STEP 5의 결과물에도 보여야 한다.
    // 단, INFO로 분류된 사진(라벨/스펙표 등)은 여기서 제외한다 — 상세페이지에
    // 실제로 쓸 사진이 아니다.
    const { html, css } = renderProductProfileHtml(
      profile,
      imageFeatures.components,
      pageCopy,
      designImages,
      input.templateKey,
    );

    return {
      imageFeatures,
      profile,
      pageCopy,
      html,
      css,
      photoTypeByImageId,
      raw: {
        provider: this.name,
        vision: {
          provider: featureCompletion.provider,
          model: featureCompletion.model,
          responseText: featureCompletion.text,
        },
        synthesis: {
          provider: synthesisCompletion.provider,
          model: synthesisCompletion.model,
          responseText: synthesisCompletion.text,
        },
        copy: {
          provider: copyCompletion.provider,
          model: copyCompletion.model,
          responseText: copyCompletion.text,
        },
        imageCount: images.length,
        omittedImageCount: input.images.length - attachedImages.length,
        skippedImages,
      },
    };
  }
}
