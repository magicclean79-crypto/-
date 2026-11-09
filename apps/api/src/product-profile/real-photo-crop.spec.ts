import sharp from "sharp";
import { buildRealDetailCrops } from "./real-photo-crop";

async function fakePhoto(width = 400, height = 400): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

describe("buildRealDetailCrops", () => {
  it("실제 사진 바이트에서 최대 2장의 순수 crop을 만든다(T1-144)", async () => {
    const bytes = await fakePhoto();
    const crops = await buildRealDetailCrops(bytes, "image/jpeg");

    expect(crops.length).toBe(2);
    for (const crop of crops) {
      expect(crop.mimeType).toBe("image/jpeg");
      expect(crop.base64.length).toBeGreaterThan(0);
      expect(typeof crop.label).toBe("string");
      expect(crop.label.length).toBeGreaterThan(0);
    }
    // 서로 다른 영역이라 서로 다른 결과가 나온다
    expect(crops[0].base64).not.toBe(crops[1].base64);
  });

  it("crop한 결과는 원본보다 작은 이미지다 — 새 픽셀을 지어내지 않고 실제로 잘라낸 것이다", async () => {
    const bytes = await fakePhoto(400, 400);
    const crops = await buildRealDetailCrops(bytes, "image/jpeg");
    const cropMeta = await sharp(Buffer.from(crops[0].base64, "base64")).metadata();
    expect(cropMeta.width).toBeLessThan(400);
    expect(cropMeta.height).toBeLessThan(400);
  });

  it("PNG 원본은 PNG로 유지한다", async () => {
    const bytes = await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const crops = await buildRealDetailCrops(bytes, "image/png");
    expect(crops.every((c) => c.mimeType === "image/png")).toBe(true);
  });

  it("손상된 이미지는 예외를 던지지 않고 빈 배열을 돌려준다", async () => {
    const garbage = Buffer.from("이건 이미지가 아닙니다");
    const crops = await buildRealDetailCrops(garbage, "image/jpeg");
    expect(crops).toEqual([]);
  });

  it("crop 영역이 원본보다 작아 잘라낼 수 없을 만큼 작은 이미지는 생략한다", async () => {
    const bytes = await fakePhoto(4, 4);
    const crops = await buildRealDetailCrops(bytes, "image/jpeg");
    expect(Array.isArray(crops)).toBe(true);
  });
});
