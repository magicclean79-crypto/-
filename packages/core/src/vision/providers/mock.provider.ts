import { createMockVisionSummary } from "../../product-object/product-object.builder";
import type {
  VisionInput,
  VisionProvider,
  VisionRecognition,
} from "../vision-provider";

/**
 * Mock Vision Provider. (VISION_PROVIDER=mock, 기본값)
 *
 * 실제 Vision 모델을 연결하기 전까지 사용하며,
 * 결정적인 VisionSummary를 반환한다.
 */
export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";

  async analyze(input: VisionInput): Promise<VisionRecognition> {
    const summary = createMockVisionSummary(input.project.name);
    return {
      summary,
      raw: {
        provider: this.name,
        input: {
          projectId: input.project.id,
          imageIds: input.images.map((image) => image.id),
          ocrTextCount: input.ocrTexts.length,
        },
        summary,
      },
    };
  }
}
