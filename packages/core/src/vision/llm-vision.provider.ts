import type { LlmImageDto, LlmMessageDto, LlmResponseFormat, VisionSummary } from "@acos/shared";
import type { PromptEngine } from "../prompt/prompt-engine";
import { VISION_ANALYSIS_TEMPLATE_KEY } from "../prompt/templates/vision-analysis.template";
import {
  parseVisionSummaryResponse,
  type VisionAnalysisContext,
} from "./vision-analysis";
import type {
  VisionInput,
  VisionProvider,
  VisionRecognition,
} from "./vision-provider";

/**
 * 한 번의 Vision 분석에 첨부하는 최대 이미지 수 기본값 (토큰·용량 보호).
 * CTO 결정(TASK-0505 승인 ①): 제한은 유지하되 환경변수로 조정 가능 —
 * apps/api는 VISION_MAX_IMAGES 환경 변수를 maxImages 옵션으로 주입한다.
 */
export const VISION_MAX_IMAGES = 5;

/** LLM Gateway 호출 함수 (Port) — apps/api에서는 LlmService가 어댑터가 된다 */
export type LlmVisionClient = (request: {
  messages: LlmMessageDto[];
  images: LlmImageDto[];
  responseFormat: LlmResponseFormat;
}) => Promise<{ provider: string; model: string; text: string }>;

/** Company Brain 컨텍스트 소스 (Port) — 프로젝트 기준으로 지식/결정/설정을 읽는다 */
export type VisionCompanyBrainSource = (
  input: VisionInput,
) => Promise<VisionAnalysisContext["companyBrain"]>;

export interface LlmVisionProviderOptions {
  promptEngine: PromptEngine;
  complete: LlmVisionClient;
  loadCompanyBrain: VisionCompanyBrainSource;
  /** 뒤에 있는 LLM Provider 이름 (예: "mock", "anthropic") — source 식별용 */
  llmProviderName: string;
  /** 첨부 이미지 수 상한 (기본 VISION_MAX_IMAGES=5, 최소 1) */
  maxImages?: number;
}

/**
 * LLM 기반 Vision Provider — 공식 Vision 엔진. (TASK-0505, Sprint 5)
 *
 * 구 MockVisionProvider를 교체한다. CTO 지시대로 네 가지를 사용한다:
 * ① Image Bytes — getBytes()로 원본을 읽어 base64로 LLM 요청에 첨부 (최대 5장)
 * ② Prompt Engine — "vision-analysis" 템플릿 렌더링
 * ③ LLM Gateway — images + responseFormat="json"으로 호출 (기본 mock)
 * ④ Company Brain — 프로젝트 이름 기준 지식/결정/설정 컨텍스트
 * 응답은 parseVisionSummaryResponse로 엄격 파싱된다 — 해석 불가면 reject되고
 * 호출자(ProductObjectService)가 재시도 후 visionSummary null로 폴백한다.
 * VisionSummary 모델(source/labels/brand/category/suggestedTitle/confidence)은
 * 변경 없이 유지된다.
 */
export class LlmVisionProvider implements VisionProvider {
  readonly name: string;
  private readonly maxImages: number;

  constructor(private readonly options: LlmVisionProviderOptions) {
    this.name = `llm:${options.llmProviderName}`;
    this.maxImages = Math.max(
      1,
      Math.floor(options.maxImages ?? VISION_MAX_IMAGES),
    );
  }

  async analyze(input: VisionInput): Promise<VisionRecognition> {
    const companyBrain = await this.options.loadCompanyBrain(input);

    const attachedImages = input.images.slice(0, this.maxImages);
    const images: LlmImageDto[] = await Promise.all(
      attachedImages.map(async (image) => ({
        mimeType: image.mimeType,
        base64: Buffer.from(await image.getBytes()).toString("base64"),
      })),
    );

    const context: VisionAnalysisContext = {
      project: {
        name: input.project.name,
        description: input.project.description,
      },
      ocrTexts: input.ocrTexts,
      imageCount: images.length,
      companyBrain,
    };
    const messages = this.options.promptEngine.render(
      VISION_ANALYSIS_TEMPLATE_KEY,
      context,
    );

    const completion = await this.options.complete({
      messages,
      images,
      responseFormat: "json",
    });
    const draft = parseVisionSummaryResponse(completion.text);
    const summary: VisionSummary = { source: this.name, ...draft };

    return {
      summary,
      raw: {
        provider: this.name,
        llm: { provider: completion.provider, model: completion.model },
        responseText: completion.text,
        imageCount: images.length,
        omittedImageCount: input.images.length - attachedImages.length,
        companyBrain: {
          knowledgeCount: companyBrain.knowledge.length,
          decisionCount: companyBrain.decisions.length,
          memoryCount: companyBrain.memories.length,
        },
      },
    };
  }
}
