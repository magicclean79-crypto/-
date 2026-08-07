import type { LlmImageDto, LlmMessageDto, LlmResponseFormat } from "@acos/shared";
import type { PromptEngine } from "../prompt/prompt-engine";
import { PRODUCT_FEATURE_VISION_TEMPLATE_KEY } from "../prompt/templates/product-feature-vision.template";
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
  step: "vision" | "synthesis";
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
}

export interface ProductProfileEngineResult {
  imageFeatures: ImageFeatureAnalysis;
  profile: ProductProfile;
  raw: {
    provider: string;
    vision: { provider: string; model: string; responseText: string };
    synthesis: { provider: string; model: string; responseText: string };
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

    return {
      imageFeatures,
      profile,
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
        imageCount: images.length,
        omittedImageCount: input.images.length - attachedImages.length,
        skippedImages,
      },
    };
  }
}
