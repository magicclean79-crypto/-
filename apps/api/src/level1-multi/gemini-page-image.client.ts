import { GoogleGenAI, Modality } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";

/** T1-189(`gemini-one-shot.client.ts`)가 실측 검증한 것과 같은 기본값 — 추측이 아니다. */
export const GEMINI_PAGE_IMAGE_DEFAULT_MODEL = "gemini-2.5-flash-image";

export class GeminiPageImageError extends Error {
  constructor(
    message: string,
    readonly finishReason?: string,
  ) {
    super(message);
    this.name = "GeminiPageImageError";
  }
}

export interface GeminiPageImageInput {
  base64: string;
  mimeType: string;
}

export interface GeminiPageImageClient {
  models: {
    generateContent: (params: GenerateContentParameters) => Promise<GenerateContentResponse>;
  };
}

export interface GeminiPageImageResult {
  model: string;
  imageBase64: string;
  mimeType: string;
}

/**
 * LEVEL 2 페이지 이미지 생성 호출(Call B) 어댑터 (T1-191).
 *
 * `apps/api/src/level1-generate/gemini-one-shot.client.ts`(T1-189)와
 * **완전히 같은 호출 형태**(`models.generateContent` +
 * `config.responseModalities: [Modality.IMAGE]`)를 쓴다 — 그 파일은
 * 이미 실 Gemini 호출로 검증됐다. 페이지마다 독립적으로 이 호출을
 * 반복한다(한 번의 호출로 여러 장을 안정적으로 받는 문서화된 방법이
 * 없다 — `LEVEL2_MULTI_PAGE_GENERATION.md` "기술 조사" 참고). 그 파일
 * 자체는 수정하지 않고 이 모듈 안에 독립된 클라이언트를 새로 둔다.
 */
export class GeminiPageImageGenerator {
  private readonly client: GeminiPageImageClient;
  readonly model: string;

  constructor(options: { apiKey: string; model?: string; client?: GeminiPageImageClient }) {
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? GEMINI_PAGE_IMAGE_DEFAULT_MODEL;
  }

  async generate(prompt: string, images: GeminiPageImageInput[]): Promise<GeminiPageImageResult> {
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
      ...images.map((image) => ({
        inlineData: { mimeType: image.mimeType, data: image.base64 },
      })),
      { text: prompt },
    ];

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: { responseModalities: [Modality.IMAGE] },
    });

    const candidate = response.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((part) => part.inlineData);
    const textPart = candidate?.content?.parts?.find((part) => part.text);

    if (!imagePart?.inlineData?.data) {
      throw new GeminiPageImageError(
        `Gemini가 이미지를 반환하지 않았습니다 (finishReason: ${candidate?.finishReason ?? "unknown"})` +
          (textPart?.text ? ` — ${textPart.text.slice(0, 300)}` : ""),
        candidate?.finishReason,
      );
    }

    return {
      model: response.modelVersion ?? this.model,
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
    };
  }
}
