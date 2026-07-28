import sharp from "sharp";
import { ImageGuardError } from "@acos/core";
import type {
  ImageGuardPolicy,
  ImagePreprocessor,
  PreparedImage,
  SourceImage,
} from "@acos/core";

const JPEG_QUALITY = 82;
const PNG_COMPRESSION_LEVEL = 9;

/**
 * sharp 기반 이미지 전처리 어댑터. (TASK-0604)
 *
 * - 리사이즈: 최대 변 policy.maxDimension, 비율 유지, 확대 없음
 * - EXIF 제거: rotate()로 EXIF 방향을 픽셀에 적용한 뒤 메타데이터 없이
 *   재인코딩 (sharp는 기본적으로 메타데이터를 출력하지 않는다)
 * - 최적화: JPEG q82 재인코딩 (투명도 있는 PNG는 PNG 유지)
 * - 용량 제한: 전처리 후에도 policy.maxOutputBytes 초과면 거부
 * 처리 불가(손상 파일 등)는 전부 ImageGuardError로 변환 —
 * Vision 경로에서 해당 이미지만 제외되도록 한다.
 */
export class SharpImagePreprocessor implements ImagePreprocessor {
  async prepare(
    image: SourceImage,
    policy: ImageGuardPolicy,
  ): Promise<PreparedImage> {
    try {
      // rotate(): EXIF Orientation을 실제 픽셀 회전으로 반영 (이후 EXIF 불필요)
      const pipeline = sharp(Buffer.from(image.bytes)).rotate().resize({
        width: policy.maxDimension,
        height: policy.maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });

      // 투명도가 있으면 PNG 유지, 그 외(JPEG/WebP/GIF 포함)는 JPEG로 최적화
      const metadata = await sharp(Buffer.from(image.bytes)).metadata();
      const keepPng = image.mimeType === "image/png" && metadata.hasAlpha;
      const output = keepPng
        ? pipeline.png({ compressionLevel: PNG_COMPRESSION_LEVEL })
        : pipeline.jpeg({ quality: JPEG_QUALITY });

      const { data, info } = await output.toBuffer({ resolveWithObject: true });
      if (data.length > policy.maxOutputBytes) {
        throw new ImageGuardError(
          `전처리 후에도 용량 제한을 초과했습니다: ${data.length} > ${policy.maxOutputBytes} bytes`,
        );
      }

      return {
        mimeType: keepPng ? "image/png" : "image/jpeg",
        bytes: data,
        width: info.width ?? null,
        height: info.height ?? null,
        sourceBytes: image.bytes.length,
      };
    } catch (error) {
      if (error instanceof ImageGuardError) {
        throw error;
      }
      throw new ImageGuardError(
        `이미지를 처리할 수 없습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
