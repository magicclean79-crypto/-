import type { LlmImageDto, LlmMessageDto, LlmResponseFormat } from "@acos/shared";
import type { PromptEngine } from "../prompt/prompt-engine";
import { DESIGN_REVIEW_TEMPLATE_KEY } from "../prompt/templates/design-review.template";
import {
  DEFAULT_IMAGE_GUARD_POLICY,
  ImageGuardError,
  validateSourceImage,
  type ImageGuardPolicy,
  type ImagePreprocessor,
} from "../vision/image-guard";
import type { VisionImageInput } from "../vision/vision-provider";
import {
  parseDesignReviewResponse,
  type DesignReviewContext,
  type DesignReviewResult,
} from "./design-review";

/** LLM Gateway 호출 함수 (Port) — apps/api에서는 LlmService가 어댑터가 된다 */
export type DesignReviewLlmClient = (request: {
  messages: LlmMessageDto[];
  images: LlmImageDto[];
  responseFormat: LlmResponseFormat;
  /** Execution feature 태깅용 — 항상 "review" 하나뿐이라 값은 고정이지만
   * ProductProfileLlmClient와 형태를 맞춰 둔다(다단계로 늘어날 가능성) */
  step: "review";
  projectId?: string;
}) => Promise<{ provider: string; model: string; text: string }>;

export interface DesignReviewEngineOptions {
  promptEngine: PromptEngine;
  complete: DesignReviewLlmClient;
  /** 뒤에 있는 LLM Provider 이름 (예: "gemini") — 이력 식별용 */
  llmProviderName: string;
  /** 첨부 이미지 수 상한 (기본 5, 최소 1) */
  maxImages?: number;
  imagePreprocessor?: ImagePreprocessor;
  imagePolicy?: ImageGuardPolicy;
}

export interface DesignReviewEngineInput {
  images: VisionImageInput[];
  category: string;
  notes?: string;
  projectId?: string;
}

export interface DesignReviewEngineResult {
  result: DesignReviewResult;
  raw: {
    provider: string;
    model: string;
    responseText: string;
    imageCount: number;
    omittedImageCount: number;
    skippedImages: { id: string; reason: string }[];
  };
}

const DEFAULT_MAX_IMAGES = 5;

/**
 * 디자인 리뷰 엔진. (Sprint 35 — "시장 디자인 패턴 학습" CTO 지시)
 *
 * `ProductProfileEngine`의 STEP 3(이미지 특징 분석)과 같은 구조 —
 * Image Guard·리사이즈를 통과한 스크린샷을 멀티모달로 첨부해 한 번
 * 호출한다. Company Brain·Project 의존이 없다 — 스크린샷만 넣으면
 * 평가가 나와야 한다는 것이 이 엔진의 전제다.
 *
 * **아직 아무 화면에서도 호출되지 않는다** — Gemini API 키가 아직
 * 확보되지 않았고(2026-08-07 기준 staging에 GOOGLE_VISION_API_KEY만
 * 있고 LLM용 Gemini 키는 없음), CTO가 "당장 호출하지 않더라도 나중에
 * 쉽게 붙일 수 있는 구조"를 요청해 미리 만들어 둔 것이다. `complete`가
 * 실제 Gemini를 부르게 하려면 apps/api에서 `LLM_ROUTE_DESIGN_REVIEW=gemini`
 * 환경변수를 설정하면 된다(packages/core/src/llm/routing.ts) — 코드 변경
 * 없이 라우팅만으로 전환된다.
 */
export class DesignReviewEngine {
  readonly name: string;
  private readonly maxImages: number;
  private readonly imagePolicy: ImageGuardPolicy;

  constructor(private readonly options: DesignReviewEngineOptions) {
    this.name = `llm:${options.llmProviderName}`;
    this.maxImages = Math.max(1, Math.floor(options.maxImages ?? DEFAULT_MAX_IMAGES));
    this.imagePolicy = options.imagePolicy ?? DEFAULT_IMAGE_GUARD_POLICY;
  }

  async run(input: DesignReviewEngineInput): Promise<DesignReviewEngineResult> {
    const attachedImages = input.images.slice(0, this.maxImages);
    const images: LlmImageDto[] = [];
    const skippedImages: { id: string; reason: string }[] = [];
    for (const image of attachedImages) {
      const source = { mimeType: image.mimeType, bytes: await image.getBytes() };
      try {
        validateSourceImage(source, this.imagePolicy);
        const prepared = this.options.imagePreprocessor
          ? await this.options.imagePreprocessor.prepare(source, this.imagePolicy)
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

    const context: DesignReviewContext = {
      category: input.category,
      notes: input.notes,
      imageCount: images.length,
    };
    const messages = this.options.promptEngine.render(DESIGN_REVIEW_TEMPLATE_KEY, context);
    const completion = await this.options.complete({
      messages,
      images,
      responseFormat: "json",
      step: "review",
      projectId: input.projectId,
    });
    const result = parseDesignReviewResponse(completion.text);

    return {
      result,
      raw: {
        provider: completion.provider,
        model: completion.model,
        responseText: completion.text,
        imageCount: images.length,
        omittedImageCount: input.images.length - attachedImages.length,
        skippedImages,
      },
    };
  }
}
