import { createDefaultPromptEngine } from "../prompt/default-engine";
import { PRODUCT_ANALYSIS_TEMPLATE_KEY } from "../prompt/templates/product-analysis.template";
import {
  AnalysisResponseParseError,
  buildDraftProductAnalysis,
  parseProductAnalysisResponse,
  type ProductAnalysisContext,
} from "./product-analysis";

const emptyBrain: ProductAnalysisContext["companyBrain"] = {
  knowledge: [],
  decisions: [],
  memories: [],
};

const context: ProductAnalysisContext = {
  product: { name: "테스트 상품", description: "등록 설명" },
  ocrTexts: ["Magic Clean PVC Mat\nMade in Korea"],
  imageCount: 2,
  companyBrain: emptyBrain,
};

describe("buildDraftProductAnalysis", () => {
  it("OCR 첫 줄을 상품 이름으로 사용한 결정적 초안을 만든다", () => {
    const draft = buildDraftProductAnalysis(context);

    expect(draft.name).toBe("Magic Clean PVC Mat");
    expect(draft.category).toBe("미분류");
    expect(draft.confidence).toBe(0.3);
    expect(draft.keywords).toEqual(["Magic", "Clean", "PVC", "Mat"]);
    expect(draft.description).toBe("등록 설명");
    expect(draft.attributes).toEqual({ imageCount: "2", ocrTextCount: "1" });
  });

  it("OCR이 없으면 상품 이름, 그것도 없으면 대체 이름을 쓴다", () => {
    const noOcr = buildDraftProductAnalysis({ ...context, ocrTexts: [] });
    expect(noOcr.name).toBe("테스트 상품");

    const nothing = buildDraftProductAnalysis({
      ...context,
      ocrTexts: [],
      product: { name: "  ", description: null },
    });
    expect(nothing.name).toBe("이름 미상 상품");
    expect(nothing.description).toContain("이름 미상 상품");
  });
});

describe("parseProductAnalysisResponse", () => {
  const valid = {
    name: "Magic Clean PVC Mat",
    category: "생활용품",
    keywords: ["매트", "PVC"],
    description: "설명",
    attributes: { origin: "Korea" },
    confidence: 0.9,
  };

  it("JSON 객체 응답을 ProductAnalysis로 파싱한다", () => {
    expect(parseProductAnalysisResponse(JSON.stringify(valid))).toEqual(valid);
  });

  it("코드 펜스·해설이 섞인 응답에서도 JSON을 추출한다", () => {
    const text = `다음은 분석 결과입니다.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n감사합니다.`;
    expect(parseProductAnalysisResponse(text).name).toBe(valid.name);
  });

  it("JSON을 찾을 수 없으면 AnalysisResponseParseError", () => {
    expect(() => parseProductAnalysisResponse("그냥 텍스트")).toThrow(
      AnalysisResponseParseError,
    );
    expect(() => parseProductAnalysisResponse("[1, 2]")).toThrow(
      AnalysisResponseParseError,
    );
  });

  it("name이 없으면 AnalysisResponseParseError", () => {
    expect(() =>
      parseProductAnalysisResponse(JSON.stringify({ category: "생활용품" })),
    ).toThrow("상품 이름(name)이 없습니다");
  });

  it("나머지 필드는 안전한 기본값으로 보정한다", () => {
    const parsed = parseProductAnalysisResponse(
      JSON.stringify({ name: " 매트 ", confidence: 7, keywords: "매트" }),
    );

    expect(parsed).toEqual({
      name: "매트",
      category: "미분류",
      keywords: [],
      description: "",
      attributes: {},
      confidence: 1,
    });
  });

  it("attributes의 숫자/불리언 값은 문자열로 변환한다", () => {
    const parsed = parseProductAnalysisResponse(
      JSON.stringify({
        name: "매트",
        attributes: { width: 120, waterproof: true, nested: { x: 1 } },
      }),
    );
    expect(parsed.attributes).toEqual({ width: "120", waterproof: "true" });
  });
});

describe("product-analysis 템플릿", () => {
  const engine = createDefaultPromptEngine();

  it("기본 엔진에 등록되어 있다", () => {
    expect(engine.has(PRODUCT_ANALYSIS_TEMPLATE_KEY)).toBe(true);
  });

  it("상품/OCR/Company Brain과 초안 JSON을 담은 메시지를 렌더링한다", () => {
    const messages = engine.render(PRODUCT_ANALYSIS_TEMPLATE_KEY, {
      ...context,
      companyBrain: {
        knowledge: [
          { title: "브랜드 표기", content: "Magic Clean", category: "BRAND" },
        ],
        decisions: [{ title: "카테고리 정책", reason: "표준화" }],
        memories: [{ key: "tone", value: "간결", description: null }],
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("JSON 객체 하나만 출력");
    expect(messages[1].content).toContain("테스트 상품");
    expect(messages[1].content).toContain("Magic Clean PVC Mat");
    expect(messages[1].content).toContain("브랜드 표기");
    expect(messages[1].content).toContain("카테고리 정책");
    expect(messages[1].content).toContain('- tone: "간결"');

    const draftBlock = /```json\n([\s\S]*?)```/.exec(messages[1].content);
    expect(draftBlock).not.toBeNull();
    expect(JSON.parse(draftBlock![1]).name).toBe("Magic Clean PVC Mat");
  });

  it("렌더링은 결정적이다 — 같은 컨텍스트는 같은 메시지를 만든다", () => {
    expect(engine.render(PRODUCT_ANALYSIS_TEMPLATE_KEY, context)).toEqual(
      engine.render(PRODUCT_ANALYSIS_TEMPLATE_KEY, context),
    );
  });
});
