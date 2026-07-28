import { extractMarkdownTitle } from "./content-generation";

// 프롬프트 조립 테스트는 TASK-0503에서 Prompt Engine으로 이관됨
// → packages/core/src/prompt/prompt-engine.spec.ts

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
