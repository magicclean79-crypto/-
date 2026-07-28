import sharp from "sharp";
import { DEFAULT_IMAGE_GUARD_POLICY, ImageGuardError } from "@acos/core";
import { SharpImagePreprocessor } from "./sharp-image.preprocessor";

describe("SharpImagePreprocessor (TASK-0604)", () => {
  const preprocessor = new SharpImagePreprocessor();

  async function createJpeg(
    width: number,
    height: number,
    orientation?: number,
  ): Promise<Uint8Array> {
    let pipeline = sharp({
      create: { width, height, channels: 3, background: "#3366aa" },
    }).jpeg({ quality: 90 });
    if (orientation !== undefined) {
      pipeline = pipeline.withMetadata({ orientation });
    }
    return new Uint8Array(await pipeline.toBuffer());
  }

  it("최대 변을 넘는 이미지는 비율을 유지하며 축소한다", async () => {
    const bytes = await createJpeg(2000, 1500);

    const prepared = await preprocessor.prepare(
      { mimeType: "image/jpeg", bytes },
      DEFAULT_IMAGE_GUARD_POLICY,
    );

    expect(prepared.mimeType).toBe("image/jpeg");
    expect(prepared.width).toBe(1024);
    expect(prepared.height).toBe(768);
    expect(prepared.sourceBytes).toBe(bytes.length);
    expect(prepared.bytes.length).toBeLessThan(bytes.length);
  });

  it("작은 이미지는 확대하지 않고 재인코딩만 한다", async () => {
    const bytes = await createJpeg(200, 100);
    const prepared = await preprocessor.prepare(
      { mimeType: "image/jpeg", bytes },
      DEFAULT_IMAGE_GUARD_POLICY,
    );
    expect(prepared.width).toBe(200);
    expect(prepared.height).toBe(100);
  });

  it("EXIF를 제거한다 — Orientation은 픽셀 회전으로 반영 후 삭제", async () => {
    // orientation 6 = 90° 회전 필요 (가로 400 → 세로로 표시되어야 함)
    const bytes = await createJpeg(400, 200, 6);
    expect((await sharp(Buffer.from(bytes)).metadata()).orientation).toBe(6);

    const prepared = await preprocessor.prepare(
      { mimeType: "image/jpeg", bytes },
      DEFAULT_IMAGE_GUARD_POLICY,
    );

    const metadata = await sharp(Buffer.from(prepared.bytes)).metadata();
    expect(metadata.orientation).toBeUndefined(); // EXIF 제거됨
    expect(metadata.exif).toBeUndefined();
    // rotate()가 방향을 픽셀에 반영 — 400x200 + orientation 6 → 200x400
    expect(prepared.width).toBe(200);
    expect(prepared.height).toBe(400);
  });

  it("투명도가 있는 PNG는 PNG를 유지한다", async () => {
    const bytes = new Uint8Array(
      await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer(),
    );

    const prepared = await preprocessor.prepare(
      { mimeType: "image/png", bytes },
      DEFAULT_IMAGE_GUARD_POLICY,
    );

    expect(prepared.mimeType).toBe("image/png");
    expect((await sharp(Buffer.from(prepared.bytes)).metadata()).format).toBe(
      "png",
    );
  });

  it("전처리 후에도 출력 용량 제한을 넘으면 ImageGuardError", async () => {
    const bytes = await createJpeg(800, 600);
    await expect(
      preprocessor.prepare(
        { mimeType: "image/jpeg", bytes },
        { ...DEFAULT_IMAGE_GUARD_POLICY, maxOutputBytes: 10 },
      ),
    ).rejects.toThrow("용량 제한을 초과");
  });

  it("손상된 이미지는 ImageGuardError로 변환된다", async () => {
    await expect(
      preprocessor.prepare(
        { mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3, 4]) },
        DEFAULT_IMAGE_GUARD_POLICY,
      ),
    ).rejects.toThrow(ImageGuardError);
  });
});
