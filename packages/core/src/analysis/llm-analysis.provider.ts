import type { LlmMessageDto, LlmResponseFormat } from "@acos/shared";
import type { PromptEngine } from "../prompt/prompt-engine";
import { PRODUCT_ANALYSIS_TEMPLATE_KEY } from "../prompt/templates/product-analysis.template";
import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisRecognition,
} from "./analysis-provider";
import {
  parseProductAnalysisResponse,
  type ProductAnalysisContext,
} from "./product-analysis";

/** LLM Gateway 호출 함수 (Port) — apps/api에서는 LlmService가 어댑터가 된다 */
export type LlmAnalysisClient = (request: {
  messages: LlmMessageDto[];
  responseFormat: LlmResponseFormat;
  /** 배정 주체 프로젝트 (TASK-1101 Sticky Assignment) */
  projectId?: string;
}) => Promise<{ provider: string; model: string; text: string }>;

/** Company Brain 컨텍스트 소스 (Port) — 상품 기준으로 지식/결정/설정을 읽는다 */
export type AnalysisCompanyBrainSource = (
  input: AnalysisInput,
) => Promise<ProductAnalysisContext["companyBrain"]>;

export interface LlmAnalysisProviderOptions {
  promptEngine: PromptEngine;
  complete: LlmAnalysisClient;
  loadCompanyBrain: AnalysisCompanyBrainSource;
  /** 뒤에 있는 LLM Provider 이름 (예: "mock", "openai") — 이력 식별용 */
  llmProviderName: string;
}

/**
 * LLM 기반 Analysis Provider — 공식 분석 엔진. (TASK-0504, Sprint 5)
 *
 * 구 MockAnalysisProvider를 교체한다. CTO 지시대로 세 가지를 사용한다:
 * ① Prompt Engine — "product-analysis" 템플릿 렌더링
 * ② LLM Gateway — responseFormat="json"으로 호출 (Provider 교체 구조, 기본 mock)
 * ③ Company Brain — 상품 이름 기준 지식/결정/설정 컨텍스트
 * 응답은 parseProductAnalysisResponse로 엄격 파싱된다 — 해석 불가면 reject되고
 * AnalysisExecutionService가 재시도 후 FAILED로 기록한다.
 */
export class LlmAnalysisProvider implements AnalysisProvider {
  readonly name: string;

  constructor(private readonly options: LlmAnalysisProviderOptions) {
    this.name = `llm:${options.llmProviderName}`;
  }

  async analyze(input: AnalysisInput): Promise<AnalysisRecognition> {
    const companyBrain = await this.options.loadCompanyBrain(input);
    const context: ProductAnalysisContext = {
      product: {
        name: input.product.name,
        description: input.product.description,
      },
      ocrTexts: input.ocrTexts,
      imageCount: input.images.length,
      companyBrain,
    };

    const messages = this.options.promptEngine.render(
      PRODUCT_ANALYSIS_TEMPLATE_KEY,
      context,
    );
    const completion = await this.options.complete({
      messages,
      responseFormat: "json",
      projectId: input.product.projectId,
    });
    const analysis = parseProductAnalysisResponse(completion.text);

    return {
      analysis,
      // 실제 호출된 Provider (TASK-1002, CTO 결정 1001-③) — 라우팅/Failover로
      // 결정되므로 생성 시점 이름이 아니라 응답의 provider를 쓴다
      providerName: `llm:${completion.provider}`,
      raw: {
        provider: this.name,
        llm: { provider: completion.provider, model: completion.model },
        responseText: completion.text,
        companyBrain: {
          knowledgeCount: companyBrain.knowledge.length,
          decisionCount: companyBrain.decisions.length,
          memoryCount: companyBrain.memories.length,
        },
      },
    };
  }
}
