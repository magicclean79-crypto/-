import { createDefaultPromptEngine } from "../prompt/default-engine";
import { PRODUCT_PAGE_COPY_TEMPLATE_KEY } from "../prompt/templates/product-page-copy.template";
import {
  ProductPageCopyParseError,
  parseProductPageCopyResponse,
  type ProductPageCopyContext,
} from "./product-page-copy";

const profile = {
  productName: "Magic Clean PVC 주방 매트",
  brand: "Magic Clean",
  model: null,
  material: "PVC",
  features: ["접이식"],
  specifications: { 두께: "5mm" },
  usage: "주방 바닥에 깔아 사용",
  advantages: ["물세척 가능"],
  warnings: [],
  keywords: ["주방매트"],
  confidence: 0.75,
};

const context: ProductPageCopyContext = { profile };

describe("parseProductPageCopyResponse", () => {
  const valid = {
    headline: "접어서 보관하는 PVC 주방 매트",
    description: "물세척이 가능한 접이식 PVC 매트로 주방 바닥을 깔끔하게 지켜줍니다.",
  };

  it("JSON 객체 응답을 ProductPageCopy로 파싱한다", () => {
    expect(parseProductPageCopyResponse(JSON.stringify(valid))).toEqual(valid);
  });

  it("코드 펜스·해설이 섞인 응답에서도 JSON을 추출한다", () => {
    const text = `카피입니다.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n감사합니다.`;
    expect(parseProductPageCopyResponse(text).headline).toBe(valid.headline);
  });

  it("JSON을 찾을 수 없으면 ProductPageCopyParseError", () => {
    expect(() => parseProductPageCopyResponse("그냥 텍스트")).toThrow(
      ProductPageCopyParseError,
    );
    expect(() => parseProductPageCopyResponse("[1, 2]")).toThrow(
      ProductPageCopyParseError,
    );
  });

  it("headline이 없으면 ProductPageCopyParseError", () => {
    expect(() =>
      parseProductPageCopyResponse(JSON.stringify({ description: "설명만 있음" })),
    ).toThrow(ProductPageCopyParseError);
  });

  it("description이 없으면 ProductPageCopyParseError", () => {
    expect(() =>
      parseProductPageCopyResponse(JSON.stringify({ headline: "제목만 있음" })),
    ).toThrow(ProductPageCopyParseError);
  });

  it("빈 문자열은 없는 것과 같다", () => {
    expect(() =>
      parseProductPageCopyResponse(
        JSON.stringify({ headline: "   ", description: "설명" }),
      ),
    ).toThrow(ProductPageCopyParseError);
  });
});

describe("product-page-copy 템플릿", () => {
  const engine = createDefaultPromptEngine();

  it("기본 엔진에 등록되어 있다", () => {
    expect(engine.has(PRODUCT_PAGE_COPY_TEMPLATE_KEY)).toBe(true);
  });

  it("Product Profile을 담은 메시지를 렌더링한다 — 이미지 재첨부·Company Brain 의존 없음", () => {
    const messages = engine.render(PRODUCT_PAGE_COPY_TEMPLATE_KEY, context);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("headline");
    expect(messages[0].content).toContain("description");
    expect(messages[1].content).toContain(profile.productName);
  });

  it("렌더링은 결정적이다", () => {
    expect(engine.render(PRODUCT_PAGE_COPY_TEMPLATE_KEY, context)).toEqual(
      engine.render(PRODUCT_PAGE_COPY_TEMPLATE_KEY, context),
    );
  });

  it("사용자 요구사항(T1-92)이 없으면 그 섹션을 만들지 않는다", () => {
    const messages = engine.render(PRODUCT_PAGE_COPY_TEMPLATE_KEY, context);

    expect(messages[1].content).not.toContain("사용자 요구사항");
  });

  it("사용자 요구사항(T1-92)이 있으면 메시지에 포함하고, 충돌 시 Product Profile을 우선하라고 명시한다", () => {
    const withRequirement: ProductPageCopyContext = {
      profile,
      userRequirement: "더 고급스러운 느낌으로 써줘",
    };
    const messages = engine.render(PRODUCT_PAGE_COPY_TEMPLATE_KEY, withRequirement);

    expect(messages[1].content).toContain("사용자 요구사항");
    expect(messages[1].content).toContain("더 고급스러운 느낌으로 써줘");
    expect(messages[0].content).toContain("Product Profile의 사실이 항상 우선한다");
  });
});
