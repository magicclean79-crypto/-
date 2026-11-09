import { MockImageEditProvider } from "@acos/core";
import { createImageEditProvider } from "./image-edit-provider.factory";
import { GeminiImageProvider } from "./providers/gemini-image.provider";
import { OpenAiImageProvider } from "./providers/openai-image.provider";

describe("createImageEditProvider", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("IMAGE_GEN_PROVIDER 미설정 · OPENAI_API_KEY만 있으면 OpenAI를 기본으로 선택한다 (T1-150)", () => {
    delete process.env.IMAGE_GEN_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";

    const provider = createImageEditProvider();

    expect(provider).toBeInstanceOf(OpenAiImageProvider);
    expect(provider.name).toBe("openai");
  });

  it("OPENAI_API_KEY가 없고 GEMINI_API_KEY만 있으면 Gemini로 대체한다", () => {
    delete process.env.IMAGE_GEN_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const provider = createImageEditProvider();

    expect(provider).toBeInstanceOf(GeminiImageProvider);
    expect(provider.name).toBe("gemini");
  });

  it("둘 다 없으면 mock으로 대체한다", () => {
    delete process.env.IMAGE_GEN_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const provider = createImageEditProvider();

    expect(provider).toBeInstanceOf(MockImageEditProvider);
  });

  it("IMAGE_GEN_PROVIDER=gemini를 명시하면 OPENAI_API_KEY가 있어도 Gemini를 쓴다", () => {
    process.env.IMAGE_GEN_PROVIDER = "gemini";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const provider = createImageEditProvider();

    expect(provider).toBeInstanceOf(GeminiImageProvider);
  });

  it("IMAGE_GEN_PROVIDER=openai인데 OPENAI_API_KEY가 없으면 mock으로 대체한다", () => {
    process.env.IMAGE_GEN_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    const provider = createImageEditProvider();

    expect(provider).toBeInstanceOf(MockImageEditProvider);
  });

  it("IMAGE_GEN_PROVIDER=mock을 명시하면 키가 있어도 mock을 쓴다", () => {
    process.env.IMAGE_GEN_PROVIDER = "mock";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const provider = createImageEditProvider();

    expect(provider).toBeInstanceOf(MockImageEditProvider);
  });
});
