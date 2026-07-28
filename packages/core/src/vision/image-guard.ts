/**
 * Image Guard & Preprocessing. (TASK-0604, Sprint 6)
 *
 * Vision Provider(LLM 멀티모달) 호출 전에 이미지를 검증·전처리한다:
 * 형식/용량 검증 → 리사이즈 → 최적화(재인코딩) → EXIF 제거 → 출력 용량 제한.
 * 검증 규칙(순수 로직)은 core에, 실제 이미지 처리(sharp)는 apps/api 어댑터에 둔다.
 * 자세한 구조: docs/architecture/vision.md
 */

export interface ImageGuardPolicy {
  /** 허용 MIME 타입 — 그 외는 거부 */
  allowedMimeTypes: string[];
  /** 원본 최대 바이트 — 초과 시 처리 없이 거부 */
  maxSourceBytes: number;
  /** 리사이즈 목표 최대 변 길이(px) — 초과 시 비율 유지 축소 */
  maxDimension: number;
  /** 전처리 후 최대 바이트 — 초과 시 거부 */
  maxOutputBytes: number;
}

export const DEFAULT_IMAGE_GUARD_POLICY: ImageGuardPolicy = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  maxSourceBytes: 20 * 1024 * 1024, // 20MB
  maxDimension: 1024,
  maxOutputBytes: 5 * 1024 * 1024, // 5MB
};

/** 이미지 검증/전처리 실패 — Vision 경로에서는 해당 이미지만 제외(스킵)된다 */
export class ImageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGuardError";
  }
}

export interface SourceImage {
  mimeType: string;
  bytes: Uint8Array;
}

/** 전처리 결과 — EXIF 등 메타데이터가 제거된 상태여야 한다 */
export interface PreparedImage {
  mimeType: string;
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
  /** 원본 크기(바이트) — 관측용 */
  sourceBytes: number;
}

/** 이미지 전처리기 (Port) — sharp 어댑터는 apps/api에 둔다 */
export interface ImagePreprocessor {
  /**
   * 리사이즈·최적화·EXIF 제거를 수행한다. 처리 불가(손상 파일,
   * 출력 용량 초과 등)면 ImageGuardError로 reject한다.
   * 원본 검증(validateSourceImage)은 호출자가 먼저 수행한다.
   */
  prepare(image: SourceImage, policy: ImageGuardPolicy): Promise<PreparedImage>;
}

/** 원본 검증 (순수 로직) — MIME 허용 목록 + 원본 용량 제한 */
export function validateSourceImage(
  image: SourceImage,
  policy: ImageGuardPolicy,
): void {
  if (!policy.allowedMimeTypes.includes(image.mimeType)) {
    throw new ImageGuardError(
      `허용되지 않는 이미지 형식입니다: ${image.mimeType} ` +
        `(허용: ${policy.allowedMimeTypes.join(", ")})`,
    );
  }
  if (image.bytes.length === 0) {
    throw new ImageGuardError("이미지가 비어 있습니다.");
  }
  if (image.bytes.length > policy.maxSourceBytes) {
    throw new ImageGuardError(
      `이미지가 원본 용량 제한을 초과했습니다: ${image.bytes.length} > ${policy.maxSourceBytes} bytes`,
    );
  }
}
