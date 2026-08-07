import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import { ImageEditError } from "@acos/core";
import {
  GeminiImageProvider,
  type GeminiImageGenerateClient,
} from "./gemini-image.provider";

function createFakeClient(overrides: {
  imageBase64?: string | null;
  finishReason?: string;
  refusalText?: string;
} = {}): { client: GeminiImageGenerateClient; calls: GenerateContentParameters[] } {
  const calls: GenerateContentParameters[] = [];
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
  if (overrides.imageBase64 !== null) {
    parts.push({ inlineData: { mimeType: "image/png", data: overrides.imageBase64 ?? "ZmFrZQ==" } });
  }
  if (overrides.refusalText) {
    parts.push({ text: overrides.refusalText });
  }
  const client: GeminiImageGenerateClient = {
    models: {
      generateContent: async (params) => {
        calls.push(params);
        return {
          modelVersion: "gemini-2.5-flash-image-001",
          candidates: [
            {
              finishReason: overrides.finishReason ?? "STOP",
              content: { parts },
            },
          ],
        } as unknown as GenerateContentResponse;
      },
    },
  };
  return { client, calls };
}

describe("GeminiImageProvider", () => {
  it("입력 이미지 없이 프롬프트만으로 이미지를 생성한다(순수 텍스트→이미지)", async () => {
    const { client, calls } = createFakeClient();
    const provider = new GeminiImageProvider({ apiKey: "test", client });

    const result = await provider.edit({ prompt: "베란다 배경을 생성해줘" });

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash-image-001");
    expect(result.imageBytes).toBe("ZmFrZQ==");
    expect(result.mimeType).toBe("image/png");
    const sentParts = (calls[0].contents as { parts: unknown[] }[])[0].parts;
    expect(sentParts).toHaveLength(1); // 이미지 입력 없이 텍스트 프롬프트 하나만
  });

  it("입력 이미지 2장(제품+배경)을 함께 보내 합성을 요청한다", async () => {
    const { client, calls } = createFakeClient();
    const provider = new GeminiImageProvider({ apiKey: "test", client });

    await provider.edit({
      prompt: "첫 번째 이미지를 두 번째 이미지에 합성해줘",
      images: [
        { mimeType: "image/png", base64: "cHJvZHVjdA==" },
        { mimeType: "image/png", base64: "YmFja2dyb3VuZA==" },
      ],
    });

    const sentParts = (calls[0].contents as { parts: unknown[] }[])[0].parts;
    expect(sentParts).toHaveLength(3); // 이미지 2장 + 텍스트 프롬프트
  });

  it("이미지가 반환되지 않으면(정책 거부 등) ImageEditError를 던진다", async () => {
    const { client } = createFakeClient({ imageBase64: null, refusalText: "안전 정책 위반" });
    const provider = new GeminiImageProvider({ apiKey: "test", client });

    await expect(provider.edit({ prompt: "..." })).rejects.toThrow(ImageEditError);
    await expect(provider.edit({ prompt: "..." })).rejects.toThrow(/안전 정책 위반/);
  });
});
