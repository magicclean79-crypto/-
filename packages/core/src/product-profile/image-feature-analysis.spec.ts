import { createDefaultPromptEngine } from "../prompt/default-engine";
import { PRODUCT_FEATURE_VISION_TEMPLATE_KEY } from "../prompt/templates/product-feature-vision.template";
import {
  ImageFeatureParseError,
  parseImageFeatureAnalysisResponse,
  type ImageFeatureAnalysisContext,
} from "./image-feature-analysis";

const context: ImageFeatureAnalysisContext = {
  ocrTexts: ["Magic Clean PVC Mat\nMade in Korea"],
  imageCount: 2,
};

describe("parseImageFeatureAnalysisResponse", () => {
  const valid = {
    material: "PVC",
    color: "그레이",
    structure: "접이식 매트",
    usage: "주방 바닥 매트",
    components: ["매트 본체", "고정 클립"],
    notes: "가장자리가 둥글게 마감됨",
    confidence: 0.85,
    photoTypes: ["DESIGN", "INFO"],
  };

  it("JSON 객체 응답을 ImageFeatureAnalysis로 파싱한다", () => {
    expect(parseImageFeatureAnalysisResponse(JSON.stringify(valid), 2)).toEqual(
      valid,
    );
  });

  it("코드 펜스·해설이 섞인 응답에서도 JSON을 추출한다", () => {
    const text = `분석 결과입니다.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n감사합니다.`;
    expect(parseImageFeatureAnalysisResponse(text, 2).material).toBe("PVC");
  });

  it("JSON을 찾을 수 없으면 ImageFeatureParseError", () => {
    expect(() => parseImageFeatureAnalysisResponse("그냥 텍스트", 1)).toThrow(
      ImageFeatureParseError,
    );
    expect(() => parseImageFeatureAnalysisResponse("[1, 2]", 1)).toThrow(
      ImageFeatureParseError,
    );
  });

  it("모든 필드가 없어도 안전한 기본값(null·빈 배열·0.5)으로 보정한다", () => {
    expect(parseImageFeatureAnalysisResponse("{}", 2)).toEqual({
      material: null,
      color: null,
      structure: null,
      usage: null,
      components: [],
      notes: null,
      confidence: 0.5,
      photoTypes: ["DESIGN", "DESIGN"],
    });
  });

  it("confidence는 0~1로 클램프한다", () => {
    expect(
      parseImageFeatureAnalysisResponse(JSON.stringify({ confidence: 7 }), 1)
        .confidence,
    ).toBe(1);
    expect(
      parseImageFeatureAnalysisResponse(JSON.stringify({ confidence: -3 }), 1)
        .confidence,
    ).toBe(0);
  });

  it("components는 문자열만 남기고 중복을 제거한다", () => {
    const parsed = parseImageFeatureAnalysisResponse(
      JSON.stringify({ components: ["A", "A", 1, null, "B"] }),
      1,
    );
    expect(parsed.components).toEqual(["A", "B"]);
  });

  it("photoTypes는 이미지 개수만큼 길이를 맞추고 INFO 외 값은 DESIGN으로 본다", () => {
    const parsed = parseImageFeatureAnalysisResponse(
      JSON.stringify({ photoTypes: ["INFO", "이상한값"] }),
      3,
    );
    expect(parsed.photoTypes).toEqual(["INFO", "DESIGN", "DESIGN"]);
  });
});

describe("product-feature-vision 템플릿", () => {
  const engine = createDefaultPromptEngine();

  it("기본 엔진에 등록되어 있다", () => {
    expect(engine.has(PRODUCT_FEATURE_VISION_TEMPLATE_KEY)).toBe(true);
  });

  it("OCR 텍스트와 이미지 수를 담은 메시지를 렌더링한다 — Company Brain 의존 없음", () => {
    const messages = engine.render(PRODUCT_FEATURE_VISION_TEMPLATE_KEY, context);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("JSON 객체 하나만 출력");
    expect(messages[0].content).toContain("material");
    expect(messages[1].content).toContain("첨부 이미지 수: 2");
    expect(messages[1].content).toContain("Magic Clean PVC Mat");
  });

  it("OCR 텍스트가 없으면 해당 섹션을 생략한다", () => {
    const messages = engine.render(PRODUCT_FEATURE_VISION_TEMPLATE_KEY, {
      ocrTexts: [],
      imageCount: 1,
    });
    expect(messages[1].content).not.toContain("참고용 OCR 텍스트");
  });

  it("렌더링은 결정적이다", () => {
    expect(engine.render(PRODUCT_FEATURE_VISION_TEMPLATE_KEY, context)).toEqual(
      engine.render(PRODUCT_FEATURE_VISION_TEMPLATE_KEY, context),
    );
  });
});
