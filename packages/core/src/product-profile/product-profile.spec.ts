import { createDefaultPromptEngine } from "../prompt/default-engine";
import { PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY } from "../prompt/templates/product-profile-synthesis.template";
import type { ImageFeatureAnalysis } from "./image-feature-analysis";
import {
  ProductProfileParseError,
  parseProductProfileResponse,
  type ProductProfileSynthesisContext,
} from "./product-profile";

const imageFeatures: ImageFeatureAnalysis = {
  material: "PVC",
  color: "그레이",
  structure: "접이식 매트",
  usage: "주방 바닥 매트",
  components: ["매트 본체", "고정 클립"],
  notes: null,
  confidence: 0.85,
  photoTypes: ["DESIGN"],
  photoCaptions: ["매트를 접어 세운 모습"],
};

const context: ProductProfileSynthesisContext = {
  ocrTexts: ["Magic Clean PVC Mat\nMade in Korea"],
  imageFeatures,
  imageCount: 2,
};

describe("parseProductProfileResponse", () => {
  const valid = {
    productName: "Magic Clean PVC 주방 매트",
    brand: "Magic Clean",
    model: "MC-100",
    material: "PVC",
    features: ["접이식", "미끄럼 방지"],
    specifications: { size: "60x90cm", weight: "800g" },
    usage: "주방 바닥에 깔아 사용",
    advantages: ["물세척 가능", "충격 완화"],
    warnings: ["직사광선 장기 노출 금지"],
    keywords: ["주방매트", "PVC매트"],
    confidence: 0.8,
  };

  it("JSON 객체 응답을 ProductProfile로 파싱한다", () => {
    expect(parseProductProfileResponse(JSON.stringify(valid))).toEqual(valid);
  });

  it("코드 펜스·해설이 섞인 응답에서도 JSON을 추출한다", () => {
    const text = `결과:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n끝.`;
    expect(parseProductProfileResponse(text).productName).toBe(
      valid.productName,
    );
  });

  it("JSON을 찾을 수 없으면 ProductProfileParseError", () => {
    expect(() => parseProductProfileResponse("그냥 텍스트")).toThrow(
      ProductProfileParseError,
    );
    expect(() => parseProductProfileResponse("[1, 2]")).toThrow(
      ProductProfileParseError,
    );
  });

  it("productName이 없으면 ProductProfileParseError", () => {
    expect(() =>
      parseProductProfileResponse(JSON.stringify({ brand: "Magic Clean" })),
    ).toThrow("productName이 없습니다");
  });

  it("나머지 필드는 안전한 기본값으로 보정한다", () => {
    const parsed = parseProductProfileResponse(
      JSON.stringify({ productName: " 매트 ", confidence: 7 }),
    );
    expect(parsed).toEqual({
      productName: "매트",
      brand: null,
      model: null,
      material: null,
      features: [],
      specifications: {},
      usage: null,
      advantages: [],
      warnings: [],
      keywords: [],
      confidence: 1,
    });
  });

  it("specifications의 숫자/불리언 값은 문자열로 변환하고 객체는 버린다", () => {
    const parsed = parseProductProfileResponse(
      JSON.stringify({
        productName: "매트",
        specifications: { width: 120, waterproof: true, nested: { x: 1 } },
      }),
    );
    expect(parsed.specifications).toEqual({ width: "120", waterproof: "true" });
  });
});

describe("product-profile-synthesis 템플릿", () => {
  const engine = createDefaultPromptEngine();

  it("기본 엔진에 등록되어 있다", () => {
    expect(engine.has(PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY)).toBe(true);
  });

  it("OCR 텍스트와 STEP 3 결과를 담은 메시지를 렌더링한다 — 이미지 재첨부 없음", () => {
    const messages = engine.render(
      PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY,
      context,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("productName");
    expect(messages[1].content).toContain("Magic Clean PVC Mat");

    const jsonBlock = /```json\n([\s\S]*?)```/.exec(messages[1].content);
    expect(jsonBlock).not.toBeNull();
    expect(JSON.parse(jsonBlock![1]).material).toBe("PVC");
  });

  it("렌더링은 결정적이다", () => {
    expect(
      engine.render(PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY, context),
    ).toEqual(engine.render(PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY, context));
  });
});
