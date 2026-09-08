import { extractGoogleVisionBoundingBoxes } from "./ocr-bounding-boxes";

describe("extractGoogleVisionBoundingBoxes", () => {
  it("Google Vision textAnnotations에서 index 0(전체 요약)을 제외한 블록만 뽑는다", () => {
    const raw = {
      engine: "google-vision",
      response: {
        textAnnotations: [
          { description: "전체 텍스트 요약", boundingPoly: { vertices: [{ x: 0, y: 0 }] } },
          {
            description: "베란다용",
            boundingPoly: {
              vertices: [
                { x: 10, y: 20 },
                { x: 50, y: 20 },
                { x: 50, y: 40 },
                { x: 10, y: 40 },
              ],
            },
          },
          { description: "스텐호스", boundingPoly: { vertices: [{ x: 60, y: 20 }, { x: 90, y: 40 }] } },
        ],
      },
    };

    const boxes = extractGoogleVisionBoundingBoxes(raw);
    expect(boxes).toHaveLength(2);
    expect(boxes?.[0]).toEqual({
      text: "베란다용",
      vertices: [
        { x: 10, y: 20 },
        { x: 50, y: 20 },
        { x: 50, y: 40 },
        { x: 10, y: 40 },
      ],
    });
  });

  it("provider가 이 모양이 아니면(mock 등) null이다 — 빈 배열과 구분한다", () => {
    expect(extractGoogleVisionBoundingBoxes({ engine: "mock", empty: true })).toBeNull();
    expect(extractGoogleVisionBoundingBoxes(null)).toBeNull();
    expect(extractGoogleVisionBoundingBoxes({ response: {} })).toBeNull();
  });

  it("글자가 없는 이미지(response는 있지만 textAnnotations 없음)도 null이다", () => {
    expect(extractGoogleVisionBoundingBoxes({ response: { fullTextAnnotation: undefined } })).toBeNull();
  });
});
