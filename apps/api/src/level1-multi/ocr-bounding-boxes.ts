/**
 * OCR 원본 응답에서 텍스트 블록별 bounding box를 뽑는다 (T1-196 요청
 * 사양 "가능하면 저장").
 *
 * `apps/api/src/ocr/providers/google-vision.provider.ts`가 이미
 * `TEXT_DETECTION`으로 호출하고 있어(`FEATURE` 상수), Google Cloud
 * Vision 응답에는 `textAnnotations`(단어/구 단위, index 0은 전체 텍스트
 * 요약이라 제외) 배열이 이미 포함돼 있다 — provider를 바꾸지 않고
 * `OcrRecognition.raw`(이미 저장되는 원본 응답)에서 파싱만 추가한다.
 *
 * **provider가 다르면(mock·tesseract) 이 모양이 아닐 수 있다** — 그때는
 * `null`을 반환한다(빈 배열이 아니다: "블록이 0개"와 "이 provider는 아예
 * 안 준다"는 다른 사실이다).
 */

export interface OcrBoundingBox {
  text: string;
  vertices: { x: number; y: number }[];
}

export function extractGoogleVisionBoundingBoxes(raw: unknown): OcrBoundingBox[] | null {
  if (!raw || typeof raw !== "object") return null;
  const response = (raw as { response?: unknown }).response;
  if (!response || typeof response !== "object") return null;
  const annotations = (response as { textAnnotations?: unknown }).textAnnotations;
  if (!Array.isArray(annotations)) return null;

  const boxes: OcrBoundingBox[] = [];
  // index 0은 전체 텍스트를 감싸는 요약 항목이라 제외한다(개별 블록이 아니다).
  for (const item of annotations.slice(1)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { description?: unknown; boundingPoly?: { vertices?: unknown } };
    if (typeof entry.description !== "string") continue;
    const rawVertices = entry.boundingPoly?.vertices;
    if (!Array.isArray(rawVertices)) continue;
    const vertices = rawVertices
      .filter(
        (v): v is { x?: number; y?: number } => typeof v === "object" && v !== null,
      )
      .map((v) => ({ x: typeof v.x === "number" ? v.x : 0, y: typeof v.y === "number" ? v.y : 0 }));
    if (vertices.length === 0) continue;
    boxes.push({ text: entry.description, vertices });
  }
  return boxes;
}
