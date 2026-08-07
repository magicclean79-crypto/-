import { GoogleGenAI, Modality } from "@google/genai";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import { ImageEditError } from "@acos/core";
import type { ImageEditProvider, ImageEditRequest, ImageEditResult } from "@acos/core";

const DEFAULT_MODEL = "gemini-2.5-flash-image";

/** 테스트에서 대체 가능한 최소 클라이언트 표면 (models.generateContent) */
export interface GeminiImageGenerateClient {
  models: {
    generateContent: (
      params: GenerateContentParameters,
    ) => Promise<GenerateContentResponse>;
  };
}

/**
 * Google Gemini 이미지 생성/편집 어댑터. (Sprint 36 — CTO 지시: Gemini는
 * 배경 제거·배경 생성·제품 합성·Hero 이미지 생성을 담당한다.)
 *
 * `GeminiLlmProvider`(apps/api/src/llm/providers/gemini.provider.ts)와 같은
 * SDK·같은 `generateContent` 메서드를 쓰지만, `config.responseModalities:
 * [Modality.IMAGE]`를 지정해 텍스트가 아니라 이미지를 돌려받는다(실측
 * 확인, 2026-08-08 — staging에서 원본 사진으로 배경 제거·배경 생성·합성
 * 3가지 모두 성공). 입력 이미지 0장이면 순수 텍스트→이미지 생성, 1장이면
 * 편집, 2장 이상이면 여러 이미지를 함께 참고한 합성이 된다 — 셋 다 이
 * 어댑터의 `edit()` 메서드 하나로 표현된다(요청 프롬프트·이미지 개수만
 * 다름).
 */
export class GeminiImageProvider implements ImageEditProvider {
  readonly name = "gemini";
  readonly defaultModel: string;
  private readonly client: GeminiImageGenerateClient;

  constructor(options: {
    apiKey: string;
    model?: string;
    /** 테스트 전용 — 미지정 시 공식 SDK 클라이언트 생성 */
    client?: GeminiImageGenerateClient;
  }) {
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async edit(request: ImageEditRequest): Promise<ImageEditResult> {
    const model = request.model ?? this.defaultModel;
    const parts: (
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    )[] = [
      ...(request.images ?? []).map((image) => ({
        inlineData: { mimeType: image.mimeType, data: image.base64 },
      })),
      { text: request.prompt },
    ];

    const response = await this.client.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { responseModalities: [Modality.IMAGE] },
    });

    const candidate = response.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((part) => part.inlineData);
    const textPart = candidate?.content?.parts?.find((part) => part.text);

    if (!imagePart?.inlineData?.data) {
      // 실측(2026-08-08): 정책상 거부되면 이미지 없이 텍스트만(거부 이유) 온다 —
      // 조용히 빈 결과를 주지 않고 원인을 그대로 드러낸다.
      throw new ImageEditError(
        `Gemini가 이미지를 반환하지 않았습니다 (finishReason: ${candidate?.finishReason ?? "unknown"})` +
          (textPart?.text ? ` — ${textPart.text.slice(0, 300)}` : ""),
        this.name,
      );
    }

    return {
      provider: this.name,
      model: response.modelVersion ?? model,
      imageBytes: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
      text: textPart?.text ?? null,
      raw: response,
    };
  }
}
