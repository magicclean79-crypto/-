import { PromptEngine } from "./prompt-engine";
import { CONTENT_GENERATION_TEMPLATE } from "./templates/content-generation.template";
import { PRODUCT_ANALYSIS_TEMPLATE } from "./templates/product-analysis.template";
import { VISION_ANALYSIS_TEMPLATE } from "./templates/vision-analysis.template";

/**
 * 기본 Prompt Engine — 현재 등록된 모든 AI 기능의 템플릿을 담는다.
 * 새 AI 기능은 자신의 PromptTemplate을 만들어 여기에 추가한다.
 */
export function createDefaultPromptEngine(): PromptEngine {
  return new PromptEngine([
    CONTENT_GENERATION_TEMPLATE,
    PRODUCT_ANALYSIS_TEMPLATE,
    VISION_ANALYSIS_TEMPLATE,
  ]);
}
