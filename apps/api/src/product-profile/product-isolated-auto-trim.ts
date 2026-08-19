import sharp from "sharp";

/**
 * 고립형(스튜디오 화이트~소프트 뉴트럴 배경) 제품 사진의 실제 여백을
 * 안전하게 잘라낸다. (T1-166)
 *
 * **왜 CSS가 아니라 픽셀을 직접 자르는가**: `object-fit:contain` 프레임의
 * letterbox 여백(T1-165가 이미 없앴다)과 이 파일이 다루는 여백은 서로 다른
 * 문제다 — 이 파일이 다루는 여백은 **이미지 파일 자체에 이미 구워져 있는
 * 흰 배경**이다(GPT Image 2 Art Direction Contract가 제품 주위에 넉넉한
 * whitespace를 명시적으로 지시한다 — `product-composition-art-direction.ts`의
 * `CATEGORY_ART_DIRECTION`). 이 렌더러(`product-story-html.ts`)는 텍스트를
 * 이미지 위에 오버레이하지 않고 별도 컬럼에 배치하므로, 그 여백은 화면에서
 * 그대로 "제품 좌우의 빈 공간"으로 보인다. CSS로는 이 문제를 고칠 수 없다 —
 * 이미 원본 이미지 픽셀 안에 흰 배경이 실재한다(실측: 벤치마크 HERO/DETAIL/
 * COMPONENTS PNG가 좌우 각 13~18%의 순수 배경 여백을 갖고 있었다).
 *
 * **왜 고정 임계값(threshold)이 아니라 이미지마다 배경을 다시 측정하는가**
 * (실측으로 발견해 고친 것): 처음엔 "RGB가 모두 238 이상이면 배경"이라는
 * 고정 규칙을 썼다. 실제 벤치마크 이미지로 검증하는 과정에서 — 이 배경이
 * 완전한 순백이 아니라 **소프트박스 조명이 만드는 은은한 그라디언트/그림자**
 * 라서(Art Direction Contract가 요구하는 그대로) 모서리 쪽 배경 픽셀이
 * 224~236 사이로 떨어지는 이미지가 있었다. 고정 임계값은 그 배경 픽셀을
 * "제품"으로 오판해 bounding box가 이미지 전체로 번지고, 그 결과 안전
 * 장치(아래 `MIN_TRIM_GAIN_RATIO`)가 걸려 트림 자체가 통째로 취소됐다 —
 * "잘리지 않는다"는 안전하지만 "여백이 눈에 띄게 준다"는 요청 사양을
 * 만족하지 못했다. 그래서 이 함수는 **그 사진 자신의 가장자리(테두리 링)를
 * 샘플링해 배경의 실제 평균색·표준편차를 먼저 측정**하고, 그 측정값 기준
 * 허용 오차로 배경을 판별한다 — 순백 배경(표준편차 거의 0)에는 좁은 허용
 * 오차를, 그라디언트/그림자가 있는 배경(표준편차가 큼)에는 그 배경 자체의
 * 실제 변동폭만큼 허용 오차를 넓힌다.
 *
 * **왜 픽셀 단위 min/max가 아니라 열/행 밀도(column/row density)로
 * bounding box를 잡는가**: 가장자리 어딘가에 노이즈 픽셀 하나(안티앨리어싱·
 * JPEG 압축 얼룩 등)만 있어도 픽셀 단위 min/max는 그 한 점 때문에 bounding
 * box가 프레임 끝까지 번진다(실측으로 확인). 이 함수는 각 열(column)·행
 * (row)에서 "배경이 아닌 픽셀"의 비율이 `CONTENT_DENSITY_THRESHOLD`를
 * 넘을 때만 그 열/행을 "콘텐츠가 있다"고 인정한다 — 희박한 노이즈 한두
 * 점은 밀도 문턱을 넘지 못해 걸러지고, 실제로 제품이 차지하는 열/행만
 * 남는다. 네 변의 여백이 서로 다를 수 있다는 것도 이 방식의 자연스러운
 * 결과다(예: 한쪽에 그림자가 있어 그 변만 여백이 없는 경우) — 대칭을
 * 억지로 맞추지 않는다.
 *
 * **적용 범위(보수적으로 고른 것, T1-166 요청 사양 B)**: `USAGE_SCENE`
 * (연출/lifestyle 사진, 실제 사용 공간이 배경이라 "흰 배경"이라는 전제
 * 자체가 성립하지 않는다)에는 절대 적용하지 않는다 — 호출자가 카테고리로
 * 걸러 이 함수를 아예 부르지 않는다. 또한 이 함수는 호출자가 `source:
 * "generated"`(GPT Image 2 파이프라인 산출물)에만 부르도록 설계됐다 —
 * `source: "real"`(사람이 업로드한 원본)은 배경이 흰색이라는 보장이 없어
 * (조명·그림자·비균일 배경 가능) 자동 배경 판별의 오탐 위험이 더 크다.
 * `CATEGORY_ART_DIRECTION`이 모든 비-USAGE_SCENE 카테고리에 "화이트~소프트
 * 뉴트럴 배경"을 명시적으로 지시하므로, 그 계약을 따른 생성 이미지에서만
 * 배경 판별이 신뢰할 수 있다 — 가장 보수적인 조합을 택했다(AGENTS.md
 * "판단이 필요하면 가장 보수적인 쪽을 스스로 고른다").
 */

export interface AutoTrimResult {
  mimeType: string;
  base64: string;
  /** 원본 대비 실제로 잘라낸 영역(0~1 비율) — 추적·디버그용, 지어낸 값 아님 */
  bounds: { left: number; top: number; width: number; height: number };
  /** bounding box 바깥으로 남긴 안전 여백(콘텐츠 크기 대비 비율) */
  marginRatio: number;
}

/** 테두리 링 샘플링 간격(픽셀) — 4장 변을 촘촘히 다 훑을 필요는 없다 */
const BORDER_SAMPLE_STRIDE = 4;
/** 배경 판별 허용 오차의 최소·표준편차 배수·상한 — 순백 배경은 좁게, 그라디언트/그림자 배경은 그 변동폭만큼 넓게 */
const TOLERANCE_MIN = 18;
const TOLERANCE_STD_MULTIPLIER = 2.2;
const TOLERANCE_MAX = 45;
/** 한 열/행에서 "배경이 아닌 픽셀"이 이 비율을 넘어야 그 열/행에 콘텐츠가 있다고 인정한다 — 가장자리 노이즈 한두 점은 걸러진다 */
const CONTENT_DENSITY_THRESHOLD = 0.02;
/** bounding box 바깥으로 남기는 안전 여백 — 요청 사양 "4~8% 정도" 범위의 중간값 */
const SAFE_MARGIN_RATIO = 0.06;
/** 이 비율보다 이미 콘텐츠가 프레임을 채우고 있으면 자를 가치가 없다(과도한 재인코딩 방지) */
const MIN_TRIM_GAIN_RATIO = 0.04;
/** bounding box가 이보다 작게 잡히면 배경 판별이 잘못됐을 가능성이 크다 — 안전하게 건너뛴다 */
const MIN_CONTENT_RATIO = 0.15;

interface BackgroundReference {
  meanR: number;
  meanG: number;
  meanB: number;
  tolerance: number;
}

/** 이미지 자신의 테두리 링을 샘플링해 배경의 실제 평균색·허용 오차를 측정한다 */
function measureBackgroundReference(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): BackgroundReference {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let n = 0;
  const samples: Array<[number, number, number]> = [];
  const push = (x: number, y: number) => {
    const idx = (y * width + x) * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    n += 1;
    samples.push([r, g, b]);
  };
  for (let x = 0; x < width; x += BORDER_SAMPLE_STRIDE) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += BORDER_SAMPLE_STRIDE) {
    push(0, y);
    push(width - 1, y);
  }
  const meanR = sumR / n;
  const meanG = sumG / n;
  const meanB = sumB / n;
  let varianceSum = 0;
  for (const [r, g, b] of samples) {
    varianceSum += (r - meanR) ** 2 + (g - meanG) ** 2 + (b - meanB) ** 2;
  }
  const std = Math.sqrt(varianceSum / (n * 3));
  const tolerance = Math.max(TOLERANCE_MIN, Math.min(TOLERANCE_MAX, std * TOLERANCE_STD_MULTIPLIER));
  return { meanR, meanG, meanB, tolerance };
}

/**
 * 고립형 제품 사진 하나의 실제 배경 여백을 안전하게 잘라낸다. 처리
 * 실패·판별 불확실 등 안전하지 않은 모든 경우 `null`을 돌려준다(트림은
 * 향상이지 필수 의존성이 아니다 — 원본 그대로 쓰는 것이 항상 안전한
 * fallback이다). **제품 본체가 잘리는 방향의 실수보다 "여백이 남는" 쪽의
 * 실수를 항상 택한다.**
 */
export async function autoTrimIsolatedProductImage(
  bytes: Buffer,
  mimeType: string,
): Promise<AutoTrimResult | null> {
  try {
    const image = sharp(bytes).rotate();
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height || width < 8 || height < 8) return null;

    const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const bg = measureBackgroundReference(data, width, height, channels);

    const isBackgroundPixel = (r: number, g: number, b: number): boolean =>
      Math.abs(r - bg.meanR) <= bg.tolerance &&
      Math.abs(g - bg.meanG) <= bg.tolerance &&
      Math.abs(b - bg.meanB) <= bg.tolerance;

    // 열/행별 "배경이 아닌 픽셀" 개수를 센다 — 픽셀 단위 min/max 대신
    // 밀도로 판정해 가장자리의 희박한 노이즈 한두 점이 bounding box
    // 전체를 무너뜨리지 않게 한다(위 파일 상단 주석 참고).
    const colForeground = new Array<number>(width).fill(0);
    const rowForeground = new Array<number>(height).fill(0);
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width * channels;
      for (let x = 0; x < width; x += 1) {
        const idx = rowOffset + x * channels;
        if (!isBackgroundPixel(data[idx], data[idx + 1], data[idx + 2])) {
          colForeground[x] += 1;
          rowForeground[y] += 1;
        }
      }
    }

    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < width; x += 1) {
      if (colForeground[x] / height > CONTENT_DENSITY_THRESHOLD) {
        if (minX < 0) minX = x;
        maxX = x;
      }
    }
    let minY = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      if (rowForeground[y] / width > CONTENT_DENSITY_THRESHOLD) {
        if (minY < 0) minY = y;
        maxY = y;
      }
    }

    // 배경 판별이 실패했거나(콘텐츠를 전혀 찾지 못함) 콘텐츠가 의심스럽게
    // 작으면(오탐 가능성) 자르지 않는다 — 안전한 쪽으로 fail한다.
    if (minX < 0 || minY < 0) return null;
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    if (contentWidth / width < MIN_CONTENT_RATIO || contentHeight / height < MIN_CONTENT_RATIO) return null;

    const marginX = Math.round(contentWidth * SAFE_MARGIN_RATIO);
    const marginY = Math.round(contentHeight * SAFE_MARGIN_RATIO);
    const left = Math.max(0, minX - marginX);
    const top = Math.max(0, minY - marginY);
    const right = Math.min(width, maxX + 1 + marginX);
    const bottom = Math.min(height, maxY + 1 + marginY);
    const cropWidth = right - left;
    const cropHeight = bottom - top;
    if (cropWidth <= 0 || cropHeight <= 0) return null;

    // 잘라내도 얻는 게 거의 없으면(이미 프레임을 채우고 있음) 원본을 그대로 쓴다.
    const widthGain = (width - cropWidth) / width;
    const heightGain = (height - cropHeight) / height;
    if (widthGain < MIN_TRIM_GAIN_RATIO && heightGain < MIN_TRIM_GAIN_RATIO) return null;

    const outputMimeType = mimeType === "image/png" ? "image/png" : "image/jpeg";
    const pipeline = sharp(bytes).rotate().extract({ left, top, width: cropWidth, height: cropHeight });
    const buffer =
      outputMimeType === "image/png"
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : await pipeline.jpeg({ quality: 92 }).toBuffer();

    return {
      mimeType: outputMimeType,
      base64: buffer.toString("base64"),
      bounds: { left: left / width, top: top / height, width: cropWidth / width, height: cropHeight / height },
      marginRatio: SAFE_MARGIN_RATIO,
    };
  } catch {
    // 손상된 이미지·처리 불가 형식 — 조용히 원본을 그대로 쓴다.
    return null;
  }
}
