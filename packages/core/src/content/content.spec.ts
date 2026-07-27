import { MockContentGenerator } from "./providers/mock.generator";
import type { ContentGenerationInput } from "./content-generator";

const input: ContentGenerationInput = {
  project: { id: "proj-1", name: "매직클린", description: "물만으로 닦는다" },
  productObject: {
    id: "po-1",
    version: 2,
    title: "Magic Clean PVC Mat",
    brand: "MagicClean",
    category: "생활용품",
    attributes: { 재질: "PVC", 원산지: "Korea" },
    ocrSummary: {
      sources: [{ imageId: "img-1", text: "Magic Clean", confidence: 0.9 }],
      combinedText: "Magic Clean PVC Mat\n49000 KRW",
      averageConfidence: 0.9,
    },
    visionSummary: null,
  },
};

describe("MockContentGenerator (Unit Test)", () => {
  const generator = new MockContentGenerator();

  it("이름은 'mock'이다", () => {
    expect(generator.name).toBe("mock");
  });

  it("Product Object를 Markdown 상세페이지로 렌더링한다", async () => {
    const result = await generator.generate(input);

    expect(result.title).toBe("Magic Clean PVC Mat 상세페이지");
    expect(result.body).toContain("# Magic Clean PVC Mat");
    expect(result.body).toContain("카테고리: 생활용품");
    expect(result.body).toContain("브랜드: MagicClean");
    expect(result.body).toContain("Product Object v2 기반");
    expect(result.body).toContain("| 재질 | PVC |");
    expect(result.body).toContain("Magic Clean PVC Mat\n49000 KRW");
    expect(result.body).toContain("물만으로 닦는다");
    expect(result.raw).toMatchObject({
      generator: "mock",
      input: { productObjectVersion: 2 },
    });
  });

  it("선택 필드가 없어도 유효한 문서를 만든다", async () => {
    const result = await generator.generate({
      project: { id: "p", name: "n", description: null },
      productObject: {
        id: "po",
        version: 1,
        title: "제목만 있는 상품",
        brand: null,
        category: null,
        attributes: {},
        ocrSummary: null,
        visionSummary: null,
      },
    });

    expect(result.body).toContain("# 제목만 있는 상품");
    expect(result.body).not.toContain("## 상세 정보");
    expect(result.body).not.toContain("## 제품 표기 정보");
  });
});
