import {
  buildContentGenerationMessages,
  extractMarkdownTitle,
} from "./content-generation";
import type { ContentGenerationContext } from "./content-generation";

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

describe("buildContentGenerationMessages", () => {
  it("system(작성 규칙) + user(구조화 정보) 2개 메시지를 조립한다", () => {
    const messages = buildContentGenerationMessages(baseContext());

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[0].content).toContain("Markdown");
    expect(messages[0].content).toContain("카피라이터");
  });

  it("Product Object·OCR·Vision·Company Brain 컨텍스트가 프롬프트에 반영된다", () => {
    const [system, user] = buildContentGenerationMessages(baseContext());

    expect(user.content).toContain("Magic Clean PVC Mat");
    expect(user.content).toContain("재질: PVC");
    expect(user.content).toContain("Magic Clean PVC Mat 60x90"); // OCR
    expect(user.content).toContain("mat, pvc"); // Vision
    expect(user.content).toContain("상세페이지 금지어"); // Knowledge
    expect(user.content).toContain("금지어 정책 도입"); // Decision
    expect(user.content).toContain("preferred-tone"); // Memory
    expect(system.content).toContain("최고, 1위"); // 금지어 지침
  });

  it("Company Brain이 비어 있어도 프롬프트가 성립한다 (섹션 생략)", () => {
    const context = baseContext();
    context.companyBrain = {
      knowledge: [],
      decisions: [],
      memories: [],
      bannedWords: null,
    };
    context.productObject.ocrText = null;
    context.productObject.visionLabels = [];

    const [system, user] = buildContentGenerationMessages(context);

    expect(system.content).not.toContain("금지어는 절대");
    expect(user.content).not.toContain("회사 지식");
    expect(user.content).not.toContain("OCR");
    expect(user.content).toContain("Magic Clean PVC Mat");
  });
});

describe("extractMarkdownTitle", () => {
  it("첫 # 헤딩을 제목으로 추출한다", () => {
    expect(
      extractMarkdownTitle("# 멋진 매트\n\n본문", "대체 제목"),
    ).toBe("멋진 매트");
    expect(
      extractMarkdownTitle("서문\n\n# 진짜 제목\n본문", "대체 제목"),
    ).toBe("진짜 제목");
  });

  it("헤딩이 없으면 fallback을 쓴다", () => {
    expect(extractMarkdownTitle("그냥 텍스트", "대체 제목")).toBe("대체 제목");
    expect(extractMarkdownTitle("## 소제목만 있음", "대체 제목")).toBe(
      "대체 제목",
    );
  });
});
