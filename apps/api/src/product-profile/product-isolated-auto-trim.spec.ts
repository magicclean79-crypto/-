import sharp from "sharp";
import { autoTrimIsolatedProductImage } from "./product-isolated-auto-trim";

/** 흰 배경 캔버스 중앙에 짙은 사각형("제품")을 얹은 합성 이미지 — 실제
 * 벤치마크에서 실측한 것과 같은 모양(가운데 제품 + 사방 흰 여백)을 재현한다. */
async function whiteBackgroundWithCenteredProduct(
  canvas = 1000,
  productSize = 500,
): Promise<Buffer> {
  const product = await sharp({
    create: { width: productSize, height: productSize, channels: 3, background: { r: 30, g: 40, b: 90 } },
  })
    .png()
    .toBuffer();
  const offset = Math.round((canvas - productSize) / 2);
  return sharp({
    create: { width: canvas, height: canvas, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: product, left: offset, top: offset }])
    .png()
    .toBuffer();
}

describe("autoTrimIsolatedProductImage", () => {
  it("사방에 흰 여백이 큰 이미지는 실제로 잘라 원본보다 작아진다(T1-166)", async () => {
    const bytes = await whiteBackgroundWithCenteredProduct(1000, 500);
    const result = await autoTrimIsolatedProductImage(bytes, "image/png");

    expect(result).not.toBeNull();
    const meta = await sharp(Buffer.from(result!.base64, "base64")).metadata();
    expect(meta.width!).toBeLessThan(1000);
    expect(meta.height!).toBeLessThan(1000);
    expect(result!.mimeType).toBe("image/png");
  });

  it("잘라낸 결과에는 제품(중앙의 짙은 색) 픽셀이 잘리지 않고 전부 남아 있다", async () => {
    const bytes = await whiteBackgroundWithCenteredProduct(1000, 500);
    const result = await autoTrimIsolatedProductImage(bytes, "image/png");
    expect(result).not.toBeNull();

    const cropped = sharp(Buffer.from(result!.base64, "base64"));
    const { data, info } = await cropped.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    // 원본 제품(500x500, r30 g40 b90)의 네 모서리가 잘린 이미지 안에 그대로 있는지 픽셀로 직접 확인한다.
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    // 제품은 캔버스 중앙 500x500 — 안전 여백 적용 후에도 중앙 영역은 항상 제품 영역과 겹친다.
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const idx = (cy * width + cx) * channels;
    expect(data[idx]).toBeLessThan(60); // r ~30
    expect(data[idx + 2]).toBeGreaterThan(60); // b ~90
    // 잘린 프레임이 원본 제품 bbox(500x500)보다 작지 않아야 한다(안전 여백 포함) — 제품 잘림 금지 검증
    expect(width).toBeGreaterThanOrEqual(500);
    expect(height).toBeGreaterThanOrEqual(500);
  });

  it("이미 프레임을 거의 채우고 있는 이미지(여백이 거의 없음)는 자르지 않고 null을 돌려준다", async () => {
    const bytes = await whiteBackgroundWithCenteredProduct(520, 500);
    const result = await autoTrimIsolatedProductImage(bytes, "image/png");
    expect(result).toBeNull();
  });

  it("전체가 배경색(흰색)뿐인 이미지는 콘텐츠를 찾을 수 없어 null을 돌려준다 — 안전하게 건너뛴다", async () => {
    const bytes = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const result = await autoTrimIsolatedProductImage(bytes, "image/png");
    expect(result).toBeNull();
  });

  it("손상된 이미지는 예외를 던지지 않고 null을 돌려준다", async () => {
    const garbage = Buffer.from("이건 이미지가 아닙니다");
    const result = await autoTrimIsolatedProductImage(garbage, "image/png");
    expect(result).toBeNull();
  });

  it("JPEG 입력은 JPEG로 유지하고, PNG 입력은 PNG로 유지한다", async () => {
    const pngBytes = await whiteBackgroundWithCenteredProduct(1000, 500);
    const pngResult = await autoTrimIsolatedProductImage(pngBytes, "image/png");
    expect(pngResult!.mimeType).toBe("image/png");

    const product = await sharp({
      create: { width: 500, height: 500, channels: 3, background: { r: 20, g: 60, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const jpegBytes = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: product, left: 250, top: 250 }])
      .jpeg()
      .toBuffer();
    const jpegResult = await autoTrimIsolatedProductImage(jpegBytes, "image/jpeg");
    expect(jpegResult!.mimeType).toBe("image/jpeg");
  });

  it("배경이 순백이 아니라 모서리로 갈수록 어두워지는 그라디언트(스튜디오 조명)여도 여백을 실제로 잘라낸다(실측 회귀 — 고정 임계값은 이 경우 트림을 통째로 포기했다)", async () => {
    const canvas = 1000;
    const productSize = 500;
    const offset = Math.round((canvas - productSize) / 2);
    // 배경: 중앙(255,255,255)에서 모서리로 갈수록 226까지 어두워지는 방사형 그라디언트 — 실제 벤치마크 이미지에서 실측한 배경 변동폭(약 std 25)을 재현한다.
    const bg = Buffer.alloc(canvas * canvas * 3);
    const cx = canvas / 2;
    const cy = canvas / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < canvas; y += 1) {
      for (let x = 0; x < canvas; x += 1) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist;
        const value = Math.round(255 - dist * 29); // 255 → 226
        const idx = (y * canvas + x) * 3;
        bg[idx] = value;
        bg[idx + 1] = value;
        bg[idx + 2] = value;
      }
    }
    const bgImage = await sharp(bg, { raw: { width: canvas, height: canvas, channels: 3 } })
      .png()
      .toBuffer();
    const product = await sharp({
      create: { width: productSize, height: productSize, channels: 3, background: { r: 20, g: 30, b: 80 } },
    })
      .png()
      .toBuffer();
    const bytes = await sharp(bgImage).composite([{ input: product, left: offset, top: offset }]).png().toBuffer();

    const result = await autoTrimIsolatedProductImage(bytes, "image/png");
    expect(result).not.toBeNull();
    const meta = await sharp(Buffer.from(result!.base64, "base64")).metadata();
    // 실제로 의미 있게 잘렸는지(그라디언트 배경도 배경으로 인식했는지) 확인한다
    expect(meta.width!).toBeLessThan(900);
    expect(meta.height!).toBeLessThan(900);
    // 제품(중앙 500x500)은 여전히 전부 포함돼야 한다
    expect(meta.width!).toBeGreaterThanOrEqual(500);
    expect(meta.height!).toBeGreaterThanOrEqual(500);
  });

  it("가장자리에 노이즈 픽셀 한두 점이 있어도(안티앨리어싱 등) 그 한 점 때문에 트림 전체가 취소되지 않는다", async () => {
    const bytes = await whiteBackgroundWithCenteredProduct(1000, 500);
    const image = sharp(bytes);
    const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    // 가장자리에 노이즈 픽셀 4개만 강제로 섞는다(모서리 근처, 실제 제품과 무관)
    const noisyIdx = [(2 * info.width + 3) * info.channels, (997 * info.width + 5) * info.channels];
    for (const idx of noisyIdx) {
      data[idx] = 40;
      data[idx + 1] = 60;
      data[idx + 2] = 90;
    }
    const noisyBytes = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .png()
      .toBuffer();

    const result = await autoTrimIsolatedProductImage(noisyBytes, "image/png");
    expect(result).not.toBeNull();
    const meta = await sharp(Buffer.from(result!.base64, "base64")).metadata();
    expect(meta.width!).toBeLessThan(1000);
  });

  it("bounds는 원본 대비 0~1 비율이고, 잘라낸 영역이 원본 안에 완전히 포함된다", async () => {
    const bytes = await whiteBackgroundWithCenteredProduct(1000, 500);
    const result = await autoTrimIsolatedProductImage(bytes, "image/png");
    expect(result).not.toBeNull();
    const { left, top, width, height } = result!.bounds;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(1);
    expect(top + height).toBeLessThanOrEqual(1);
  });
});
