import OpenAI, { toFile } from "openai";
import { ImageEditError } from "@acos/core";
import type { ImageEditProvider, ImageEditRequest, ImageEditResult } from "@acos/core";

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "high";

/** 테스트에서 대체 가능한 최소 클라이언트 표면 (images.generate/images.edit) */
export interface OpenAiImageClient {
  images: {
    generate: (
      params: OpenAI.Images.ImageGenerateParamsNonStreaming,
    ) => Promise<OpenAI.Images.ImagesResponse>;
    edit: (
      params: OpenAI.Images.ImageEditParamsNonStreaming,
    ) => Promise<OpenAI.Images.ImagesResponse>;
  };
}

/**
 * OpenAI GPT Image 2 어댑터. (T1-150 — 사장님 피드백: Gemini 단독 생성이
 * 방금 승인한 프리미엄 시안 수준에 못 미침. 실측 벤치마크로 GPT Image 2를
 * primary visual composition generator로 확정.)
 *
 * `GeminiImageProvider`(gemini-image.provider.ts)와 같은 Port
 * (`ImageEditProvider.edit()`)를 구현한다 — 입력 이미지 0장이면 순수
 * 텍스트→이미지(`images.generate`), 1장 이상이면 편집/합성
 * (`images.edit`, 최대 16장까지 참조 가능)으로 자동 분기한다. GPT image
 * 모델(`gpt-image-1`·`gpt-image-2` 등)은 `response_format`을 지원하지
 * 않고 항상 base64(`b64_json`)로 응답한다(공식 SDK 타입 주석 확인,
 * 2026-08-18 실측 — `client.models.list()`에서 `gpt-image-2`,
 * `gpt-image-2-2026-04-21` 접근 가능 확인).
 */
export class OpenAiImageProvider implements ImageEditProvider {
  readonly name = "openai";
  readonly defaultModel: string;
  private readonly client: OpenAiImageClient;

  constructor(options: {
    apiKey: string;
    model?: string;
    /** 테스트 전용 — 미지정 시 공식 SDK 클라이언트 생성 */
    client?: OpenAiImageClient;
  }) {
    this.client = options.client ?? (new OpenAI({ apiKey: options.apiKey }) as unknown as OpenAiImageClient);
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async edit(request: ImageEditRequest): Promise<ImageEditResult> {
    const model = request.model ?? this.defaultModel;
    const images = request.images ?? [];
    const quality = request.quality ?? DEFAULT_QUALITY;

    const response =
      images.length === 0
        ? await this.client.images.generate({
            model,
            prompt: request.prompt,
            size: DEFAULT_SIZE,
            quality,
          })
        : await this.client.images.edit({
            model,
            image: await Promise.all(
              images.map((image, index) =>
                toFile(Buffer.from(image.base64, "base64"), `reference-${index}.png`, {
                  type: image.mimeType,
                }),
              ),
            ),
            prompt: request.prompt,
            size: DEFAULT_SIZE,
            quality,
          });

    const first = response.data?.[0];
    if (!first?.b64_json) {
      // Gemini 어댑터와 같은 원칙(M-26) — 실패를 조용히 삼키지 않는다.
      throw new ImageEditError(
        `OpenAI가 이미지를 반환하지 않았습니다 (model: ${model})`,
        this.name,
      );
    }

    return {
      provider: this.name,
      model,
      imageBytes: first.b64_json,
      mimeType: "image/png",
      text: first.revised_prompt ?? null,
      raw: response,
    };
  }
}
