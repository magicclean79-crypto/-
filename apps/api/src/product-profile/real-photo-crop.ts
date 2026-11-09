import sharp from "sharp";

/**
 * 실제 업로드 원본 사진에서 순수 crop(확대/부분 확대)만 만든다. (T1-144 —
 * 이미지 밀도 확대)
 *
 * Gemini를 호출하지 않는다 — 같은 픽셀을 자르기만 하므로 "실제 제품
 * 사진"이라는 성격이 그대로 유지된다(`docs/MASTER_GUIDE.md` 제품 동일성
 * 원칙과 정확히 부합 — 새로운 픽셀을 지어내지 않는다). 요청 사양 4 "제품
 * 디테일 crop/zoom asset을 추가"를 정확히 이 방식으로 구현한다: AI가 새
 * 각도를 상상하는 대신, 실제로 존재하는 사진을 사람이 보기 좋게 확대해서
 * 보여준다.
 *
 * 이 저장소에는 이미 `apps/api/src/product-object/sharp-image.preprocessor.ts`
 * 가 같은 sharp 의존성으로 리사이즈·재인코딩을 하고 있다 — 새 의존성을
 * 추가하지 않는다.
 */
export interface RealPhotoCrop {
  /** 이 crop이 원본 사진의 어느 부분인지 사람이 읽을 수 있는 이름표 */
  label: string;
  mimeType: string;
  base64: string;
}

interface CropSpec {
  label: string;
  /** 원본 대비 잘라낼 영역(0~1 비율) — left/top은 시작점, width/height는 크기 */
  region: { left: number; top: number; width: number; height: number };
}

/**
 * 중앙 확대(제품 전체를 크게) + 하단 확대(질감·마감이 몰려 있는 경우가
 * 많은 아래쪽을 확대) 두 가지만 만든다 — crop 방향을 지어내지 않고,
 * "실제 그 사진 안에 있는 것을 더 크게 보여준다"는 목적에 맞는 가장
 * 보수적인 2개만 둔다.
 */
const CROP_SPECS: CropSpec[] = [
  { label: "중앙 확대", region: { left: 0.2, top: 0.15, width: 0.6, height: 0.6 } },
  { label: "하단부 확대", region: { left: 0.1, top: 0.45, width: 0.8, height: 0.5 } },
];

const MAX_CROPS = 2;

/**
 * 실제 사진 하나에서 crop 최대 `MAX_CROPS`장을 만든다. 처리 실패(손상된
 * 이미지 등)는 예외를 던지지 않고 빈 배열을 돌려준다 — crop은 향상이지
 * 필수 의존성이 아니다(원본 사진 자체는 이미 그대로 쓰인다).
 */
export async function buildRealDetailCrops(
  bytes: Buffer,
  mimeType: string,
): Promise<RealPhotoCrop[]> {
  try {
    const image = sharp(bytes).rotate();
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return [];

    const outputMimeType = mimeType === "image/png" ? "image/png" : "image/jpeg";
    const crops: RealPhotoCrop[] = [];
    for (const spec of CROP_SPECS.slice(0, MAX_CROPS)) {
      const left = Math.round(width * spec.region.left);
      const top = Math.round(height * spec.region.top);
      const cropWidth = Math.max(1, Math.round(width * spec.region.width));
      const cropHeight = Math.max(1, Math.round(height * spec.region.height));
      if (left + cropWidth > width || top + cropHeight > height) continue;
      const pipeline = sharp(bytes).rotate().extract({ left, top, width: cropWidth, height: cropHeight });
      const buffer =
        outputMimeType === "image/png"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : await pipeline.jpeg({ quality: 85 }).toBuffer();
      crops.push({ label: spec.label, mimeType: outputMimeType, base64: buffer.toString("base64") });
    }
    return crops;
  } catch {
    // 손상된 이미지·처리 불가 형식 — 조용히 생략한다(원본은 이미 그대로 쓰인다).
    return [];
  }
}
