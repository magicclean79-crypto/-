import { GoogleGenAI, Modality } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";

/** LEVEL1_ONE_SHOT_GENERATION.md — 검증된 모델명(코드 실측, 추측 아님) */
export const GEMINI_ONE_SHOT_DEFAULT_MODEL = "gemini-2.5-flash-image";

export class GeminiOneShotError extends Error {
  constructor(
    message: string,
    readonly finishReason?: string,
  ) {
    super(message);
    this.name = "GeminiOneShotError";
  }
}

export interface GeminiOneShotImageInput {
  base64: string;
  mimeType: string;
}

export interface GeminiOneShotClient {
  models: {
    generateContent: (params: GenerateContentParameters) => Promise<GenerateContentResponse>;
  };
}

export interface GeminiOneShotResult {
  model: string;
  imageBase64: string;
  mimeType: string;
  text: string | null;
}

/**
 * LEVEL 1 원샷 상세페이지 생성 어댑터 (T1-189).
 *
 * `apps/api/src/image-gen/providers/gemini-image.provider.ts`(기존 image-gen
 * 파이프라인, T1-188과 동시 작업 중이라 이번 작업은 그 파일을 재사용/수정하지
 * 않는다 — `docs/PROJECT_MEMORY.md` M-28)와 **같은 SDK·같은 호출 형태**
 * (`models.generateContent` + `config.responseModalities: [Modality.IMAGE]`)를
 * 쓴다 — 이 형태가 실제로 이미지 입력 여러 장 + 이미지 출력 1장을 반환한다는
 * 것은 그 provider가 이미 staging에서 실측 확인했다(주석 참고). 이 클래스는
 * 그 실측된 API 형태만 그대로 가져와 "분석+디자인+생성"을 한 번에 지시하는
 * 프롬프트로 감싼 것이며, 새 API·새 모델을 만들지 않는다.
 */
export class GeminiOneShotGenerator {
  private readonly client: GeminiOneShotClient;
  readonly model: string;

  constructor(options: { apiKey: string; model?: string; client?: GeminiOneShotClient }) {
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? GEMINI_ONE_SHOT_DEFAULT_MODEL;
  }

  /** 하나의 generateContent 호출로 분석·디자인 결정·최종 이미지 생성을 끝낸다. */
  async generate(prompt: string, images: GeminiOneShotImageInput[]): Promise<GeminiOneShotResult> {
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
      throw new GeminiOneShotError(
        `Gemini가 이미지를 반환하지 않았습니다 (finishReason: ${candidate?.finishReason ?? "unknown"})` +
          (textPart?.text ? ` — ${textPart.text.slice(0, 300)}` : ""),
        candidate?.finishReason,
      );
    }

    return {
      model: response.modelVersion ?? this.model,
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
      text: textPart?.text ?? null,
    };
  }
}
