import type OpenAI from "openai";
import { ImageEditError } from "@acos/core";
import { OpenAiImageProvider, type OpenAiImageClient } from "./openai-image.provider";

function createFakeClient(overrides: { b64Json?: string | null; revisedPrompt?: string } = {}): {
  client: OpenAiImageClient;
  generateCalls: OpenAI.Images.ImageGenerateParamsNonStreaming[];
  editCalls: OpenAI.Images.ImageEditParamsNonStreaming[];
} {
  const generateCalls: OpenAI.Images.ImageGenerateParamsNonStreaming[] = [];
  const editCalls: OpenAI.Images.ImageEditParamsNonStreaming[] = [];
  const data =
    overrides.b64Json === null
      ? []
      : [{ b64_json: overrides.b64Json ?? "ZmFrZQ==", revised_prompt: overrides.revisedPrompt }];
  const client: OpenAiImageClient = {
    images: {
      generate: async (params) => {
        generateCalls.push(params);
        return { created: 0, data } as OpenAI.Images.ImagesResponse;
      },
      edit: async (params) => {
        editCalls.push(params);
        return { created: 0, data } as OpenAI.Images.ImagesResponse;
      },
    },
  };
  return { client, generateCalls, editCalls };
}

describe("OpenAiImageProvider", () => {
  it("입력 이미지 없이 프롬프트만으로 이미지를 생성한다(images.generate)", async () => {
    const { client, generateCalls, editCalls } = createFakeClient();
    const provider = new OpenAiImageProvider({ apiKey: "test", client });

    const result = await provider.edit({ prompt: "베란다 배경을 생성해줘" });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-image-2");
    expect(result.imageBytes).toBe("ZmFrZQ==");
    expect(result.mimeType).toBe("image/png");
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].prompt).toBe("베란다 배경을 생성해줘");
    expect(editCalls).toHaveLength(0);
  });

  it("입력 이미지 2장(제품+배경)을 함께 보내면 images.edit으로 합성을 요청한다", async () => {
    const { client, editCalls, generateCalls } = createFakeClient();
    const provider = new OpenAiImageProvider({ apiKey: "test", client });

    await provider.edit({
      prompt: "첫 번째 이미지를 두 번째 이미지에 합성해줘",
      images: [
        { mimeType: "image/png", base64: "cHJvZHVjdA==" },
        { mimeType: "image/png", base64: "YmFja2dyb3VuZA==" },
      ],
    });

    expect(editCalls).toHaveLength(1);
    expect(Array.isArray(editCalls[0].image)).toBe(true);
    expect((editCalls[0].image as unknown[]).length).toBe(2);
    expect(generateCalls).toHaveLength(0);
  });

  it("model 옵션을 주면 그 모델로 호출한다", async () => {
    const { client, generateCalls } = createFakeClient();
    const provider = new OpenAiImageProvider({ apiKey: "test", model: "gpt-image-2-2026-04-21", client });

    await provider.edit({ prompt: "..." });

    expect(generateCalls[0].model).toBe("gpt-image-2-2026-04-21");
  });

  it("이미지가 반환되지 않으면 ImageEditError를 던진다", async () => {
    const { client } = createFakeClient({ b64Json: null });
    const provider = new OpenAiImageProvider({ apiKey: "test", client });

    await expect(provider.edit({ prompt: "..." })).rejects.toThrow(ImageEditError);
  });

  it("quality를 지정하지 않으면 기본값 high로 호출한다", async () => {
    const { client, generateCalls } = createFakeClient();
    const provider = new OpenAiImageProvider({ apiKey: "test", client });

    await provider.edit({ prompt: "..." });

    expect(generateCalls[0].quality).toBe("high");
  });

  it("quality:'low'를 지정하면 그대로 전달한다 (T1-152 — 장식용 자산은 저품질로 지연을 줄인다)", async () => {
    const { client, generateCalls } = createFakeClient();
    const provider = new OpenAiImageProvider({ apiKey: "test", client });

    await provider.edit({ prompt: "...", quality: "low" });

    expect(generateCalls[0].quality).toBe("low");
  });
});
