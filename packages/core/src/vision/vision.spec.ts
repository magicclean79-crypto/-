import { MockVisionProvider } from "./providers/mock.provider";
import type { VisionInput } from "./vision-provider";

const input: VisionInput = {
  project: { id: "proj-1", name: "매직클린 걸레", description: null },
  images: [
    {
      id: "img-1",
      mimeType: "image/png",
      getBytes: async () => new Uint8Array(3),
    },
  ],
  ocrTexts: ["Magic Clean PVC Mat"],
};

describe("MockVisionProvider (Unit Test)", () => {
  const provider = new MockVisionProvider();

  it("이름은 'mock'이다", () => {
    expect(provider.name).toBe("mock");
  });

  it("결정적인 VisionSummary를 반환한다", async () => {
    const { summary, raw } = await provider.analyze(input);

    expect(summary).toEqual({
      source: "mock",
      labels: ["mock-vision", "product"],
      brand: null,
      category: "생활용품",
      suggestedTitle: "매직클린 걸레",
      confidence: 0.9,
    });
    expect(raw).toMatchObject({
      provider: "mock",
      input: { projectId: "proj-1", imageIds: ["img-1"], ocrTextCount: 1 },
    });
  });

  it("이미지 바이트를 읽지 않는다 (lazy 로더 유지)", async () => {
    const getBytes = jest.fn(async () => new Uint8Array(1));
    await provider.analyze({
      ...input,
      images: [{ id: "img-1", mimeType: "image/png", getBytes }],
    });
    expect(getBytes).not.toHaveBeenCalled();
  });
});
