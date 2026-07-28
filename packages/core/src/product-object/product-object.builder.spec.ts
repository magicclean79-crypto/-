import { ProductObjectBuilder } from "./product-object.builder";

const project = {
  id: "proj-1",
  name: "매직클린 걸레",
  description: null,
};

describe("ProductObjectBuilder (Unit Test)", () => {
  it("입력이 없어도 프로젝트 이름으로 유효한 Draft를 만든다", () => {
    const draft = new ProductObjectBuilder(project).build();

    expect(draft.title).toBe("매직클린 걸레");
    expect(draft.brand).toBeNull();
    expect(draft.category).toBeNull();
    expect(draft.ocrSummary).toBeNull();
    expect(draft.visionSummary).toBeNull();
    expect(draft.metadata.builderVersion).toBe("1.0.0");
    expect(draft.metadata.ocrSourceCount).toBe(0);
  });

  it("OCR 결과를 요약으로 조립한다 (결합 텍스트 + 평균 신뢰도)", () => {
    const draft = new ProductObjectBuilder(project)
      .withOcrResults([
        { imageId: "img-1", text: "Magic Clean PVC Mat\n49000 KRW", confidence: 0.9 },
        { imageId: "img-2", text: "Made in Korea", confidence: 0.8 },
        { imageId: "img-3", text: "   ", confidence: 0.5 }, // 빈 텍스트 제외
      ])
      .build();

    expect(draft.ocrSummary?.sources).toHaveLength(2);
    expect(draft.ocrSummary?.combinedText).toBe(
      "Magic Clean PVC Mat\n49000 KRW\n---\nMade in Korea",
    );
    expect(draft.ocrSummary?.averageConfidence).toBeCloseTo(0.85);
    expect(draft.metadata.ocrSourceCount).toBe(2);
  });

  it("제목 우선순위: Vision 제안 → OCR 첫 줄 → 프로젝트 이름", () => {
    const ocr = [{ imageId: "img-1", text: "OCR 첫 줄", confidence: 0.9 }];
    const vision = {
      source: "llm:mock",
      labels: ["product"],
      brand: null,
      category: null,
      suggestedTitle: "Vision 제목",
      confidence: 0.9,
    };

    expect(
      new ProductObjectBuilder(project)
        .withOcrResults(ocr)
        .withVisionSummary(vision)
        .build().title,
    ).toBe("Vision 제목");

    expect(
      new ProductObjectBuilder(project)
        .withOcrResults(ocr)
        .withVisionSummary({ ...vision, suggestedTitle: null })
        .build().title,
    ).toBe("OCR 첫 줄");

    expect(new ProductObjectBuilder(project).build().title).toBe(
      "매직클린 걸레",
    );
  });

  it("Vision 요약에서 brand/category/labels를 가져온다", () => {
    const vision = {
      source: "mock",
      labels: ["mat", "pvc"],
      brand: "MagicClean",
      category: "주방용품",
      suggestedTitle: null,
      confidence: 0.9,
    };
    const draft = new ProductObjectBuilder(project)
      .withVisionSummary(vision)
      .withAttributes({ origin: "Korea" })
      .build();

    expect(draft.brand).toBe("MagicClean");
    expect(draft.category).toBe("주방용품");
    expect(draft.attributes).toEqual({
      visionLabels: "mat, pvc",
      origin: "Korea",
    });
    expect(draft.visionSummary).toEqual(vision);
  });

  it("confidence가 전부 null이면 평균 신뢰도도 null이다", () => {
    const draft = new ProductObjectBuilder(project)
      .withOcrResults([{ imageId: "img-1", text: "텍스트", confidence: null }])
      .build();
    expect(draft.ocrSummary?.averageConfidence).toBeNull();
  });
});
