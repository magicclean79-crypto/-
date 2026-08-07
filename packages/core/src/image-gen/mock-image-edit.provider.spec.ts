import { MockImageEditProvider } from "./mock-image-edit.provider";

describe("MockImageEditProvider", () => {
  it("입력 이미지 없이도(순수 텍스트→이미지) 이미지 바이트를 반환한다", async () => {
    const provider = new MockImageEditProvider();
    const result = await provider.edit({ prompt: "베란다 배경을 생성해줘" });
    expect(result.provider).toBe("mock");
    expect(result.imageBytes.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe("image/png");
  });

  it("입력 이미지가 있으면(편집/합성) raw에 이미지 개수를 기록한다", async () => {
    const provider = new MockImageEditProvider();
    const result = await provider.edit({
      prompt: "배경을 제거해줘",
      images: [{ mimeType: "image/jpeg", base64: "abc" }],
    });
    expect(result.raw).toEqual({ mock: true, imageCount: 1 });
  });
});
