import type { ContentGenerationContext } from "../content-generation/content-generation";
import { createDefaultPromptEngine } from "./default-engine";
import { PromptEngine } from "./prompt-engine";
import type { PromptTemplate } from "./prompt-engine";

function baseContext(): ContentGenerationContext {
  return {
    project: { name: "매직클린", description: "물만으로 닦는다" },
    productObject: {
      version: 4,
      title: "Magic Clean PVC Mat",
      brand: "MagicClean",
      category: "생활용품",
      attributes: { 재질: "PVC", 크기: "60x90" },
      ocrText: "Magic Clean PVC Mat 60x90",
      visionLabels: ["mat", "pvc"],
    },
    companyBrain: {
      knowledge: [
        { title: "상세페이지 금지어", content: "최상급 표현 금지", category: "RULE" },
      ],
      decisions: [{ title: "금지어 정책 도입", reason: "법적 리스크 축소" }],
      memories: [
        { key: "preferred-tone", value: { tone: "친근함" }, description: "문체" },
      ],
      bannedWords: ["최고", "1위"],
    },
  };
}

describe("PromptEngine", () => {
  const noopTemplate = (key: string): PromptTemplate<{ q: string }> => ({
    key,
    name: key,
    description: `${key} 템플릿`,
    build: (input) => [{ role: "user", content: input.q }],
  });

  it("템플릿을 key로 렌더링하고, 미등록 key는 오류를 던진다", () => {
    const engine = new PromptEngine([noopTemplate("a")]);

    expect(engine.render("a", { q: "질문" })).toEqual([
      { role: "user", content: "질문" },
    ]);
    expect(engine.has("a")).toBe(true);
    expect(engine.has("b")).toBe(false);
    expect(() => engine.render("b", { q: "x" })).toThrow(/등록되지 않은/);
  });

  it("중복 key 등록은 생성 시점에 오류를 던진다", () => {
    expect(
      () => new PromptEngine([noopTemplate("a"), noopTemplate("a")]),
    ).toThrow(/중복/);
  });

  it("list()가 등록된 템플릿 정보를 반환한다", () => {
    const engine = createDefaultPromptEngine();
    expect(engine.list()).toEqual([
      {
        key: "content-generation",
        name: "상세페이지 생성",
        description: expect.stringContaining("Company Brain"),
      },
      {
        key: "product-analysis",
        name: "상품 분석",
        description: expect.stringContaining("ProductAnalysis"),
      },
      {
        key: "vision-analysis",
        name: "Vision 이미지 분석",
        description: expect.stringContaining("VisionSummary"),
      },
      {
        key: "product-feature-vision",
        name: "이미지 특징 분석",
        description: expect.stringContaining("재질"),
      },
      {
        key: "product-profile-synthesis",
        name: "Product Profile 통합",
        description: expect.stringContaining("Product Profile"),
      },
      {
        key: "product-page-copy",
        name: "상세페이지 카피 생성",
        description: expect.stringContaining("대표 문구"),
      },
    ]);
  });
});

describe("content-generation 템플릿 (기본 엔진 등록)", () => {
  it("system(작성 규칙) + user(구조화 정보) 2개 메시지를 렌더링한다", () => {
    const engine = createDefaultPromptEngine();
    const messages = engine.render("content-generation", baseContext());

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[0].content).toContain("Markdown");
    expect(messages[0].content).toContain("카피라이터");
  });

  it("Product Object·OCR·Vision·Company Brain 컨텍스트가 프롬프트에 반영된다", () => {
    const engine = createDefaultPromptEngine();
    const [system, user] = engine.render("content-generation", baseContext());

    expect(user.content).toContain("Magic Clean PVC Mat");
    expect(user.content).toContain("재질: PVC");
    expect(user.content).toContain("Magic Clean PVC Mat 60x90"); // OCR
    expect(user.content).toContain("mat, pvc"); // Vision
    expect(user.content).toContain("상세페이지 금지어"); // Knowledge
    expect(user.content).toContain("금지어 정책 도입"); // Decision
    expect(user.content).toContain("preferred-tone"); // Memory
    expect(system.content).toContain("최고, 1위"); // 금지어 지침
  });

  it("Company Brain이 비어 있어도 렌더링이 성립한다 (섹션 생략)", () => {
    const context = baseContext();
    context.companyBrain = {
      knowledge: [],
      decisions: [],
      memories: [],
      bannedWords: null,
    };
    context.productObject.ocrText = null;
    context.productObject.visionLabels = [];

    const engine = createDefaultPromptEngine();
    const [system, user] = engine.render("content-generation", context);

    expect(system.content).not.toContain("금지어는 절대");
    expect(user.content).not.toContain("회사 지식");
    expect(user.content).not.toContain("OCR");
    expect(user.content).toContain("Magic Clean PVC Mat");
  });
});
