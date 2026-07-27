import type { ProductAnalysis } from "@acos/shared";
import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisRecognition,
} from "../analysis-provider";

export const MOCK_ANALYSIS_FALLBACK_NAME = "Magic Clean PVC Mat";
export const MOCK_ANALYSIS_CONFIDENCE = 0.95;

/**
 * Mock Analysis Provider.
 *
 * 실제 AI API를 연결하기 전까지 사용하는 기본 Provider.
 * 입력(OCR 텍스트/상품 정보)에 대해 결정적인 구조화 결과를 반환한다.
 */
export class MockAnalysisProvider implements AnalysisProvider {
  readonly name = "mock";

  async analyze(input: AnalysisInput): Promise<AnalysisRecognition> {
    const firstOcrLine = input.ocrTexts
      .flatMap((text) => text.split("\n"))
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    const name = firstOcrLine ?? input.product.name ?? MOCK_ANALYSIS_FALLBACK_NAME;

    const analysis: ProductAnalysis = {
      name,
      category: "생활용품",
      keywords: ["mock", "생활용품", ...(firstOcrLine ? [firstOcrLine.split(" ")[0]] : [])],
      description: `${name}에 대한 AI 생성 설명 초안입니다. (mock)`,
      attributes: {
        source: "mock-analysis",
        imageCount: String(input.images.length),
        ocrTextCount: String(input.ocrTexts.length),
      },
      confidence: MOCK_ANALYSIS_CONFIDENCE,
    };

    return {
      analysis,
      raw: {
        provider: this.name,
        input: {
          productId: input.product.id,
          imageIds: input.images.map((image) => image.id),
          ocrTexts: input.ocrTexts,
        },
        analysis,
      },
    };
  }
}
