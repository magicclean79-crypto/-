import {
  DEFAULT_IMAGE_GUARD_POLICY,
  ImageGuardError,
  validateSourceImage,
} from "./image-guard";

describe("validateSourceImage (Image Guard, TASK-0604)", () => {
  const png = { mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) };

  it("허용 형식·용량 이내면 통과한다", () => {
    expect(() =>
      validateSourceImage(png, DEFAULT_IMAGE_GUARD_POLICY),
    ).not.toThrow();
  });

  it("허용되지 않는 MIME 타입은 거부한다", () => {
    expect(() =>
      validateSourceImage(
        { ...png, mimeType: "application/pdf" },
        DEFAULT_IMAGE_GUARD_POLICY,
      ),
    ).toThrow(ImageGuardError);
    expect(() =>
      validateSourceImage(
        { ...png, mimeType: "image/svg+xml" },
        DEFAULT_IMAGE_GUARD_POLICY,
      ),
    ).toThrow("허용되지 않는 이미지 형식");
  });

  it("빈 이미지·원본 용량 초과는 거부한다", () => {
    expect(() =>
      validateSourceImage(
        { ...png, bytes: new Uint8Array(0) },
        DEFAULT_IMAGE_GUARD_POLICY,
      ),
    ).toThrow("비어 있습니다");
    expect(() =>
      validateSourceImage(png, {
        ...DEFAULT_IMAGE_GUARD_POLICY,
        maxSourceBytes: 2,
      }),
    ).toThrow("원본 용량 제한");
  });
});
