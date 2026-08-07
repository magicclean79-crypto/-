import type { ImageEditProvider, ImageEditRequest, ImageEditResult } from "./image-edit-provider";

/** 1x1 투명 PNG — 실 Provider 키가 없을 때도 기동·테스트가 가능하게 하는 최소 placeholder */
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/** MockLlmProvider(packages/core/src/llm/providers/mock.provider.ts)와 같은 원칙 —
 * API 키가 없는 환경에서도 항상 기동·테스트되게 하는 기본 Provider. */
export class MockImageEditProvider implements ImageEditProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-image-1";

  async edit(request: ImageEditRequest): Promise<ImageEditResult> {
    return {
      provider: this.name,
      model: request.model ?? this.defaultModel,
      imageBytes: PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png",
      text: `[mock-image] ${request.prompt.slice(0, 200)} (입력 이미지 ${request.images?.length ?? 0}장)`,
      raw: { mock: true, imageCount: request.images?.length ?? 0 },
    };
  }
}
