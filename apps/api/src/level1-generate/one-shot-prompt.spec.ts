import { buildOneShotPrompt } from "./one-shot-prompt";

describe("buildOneShotPrompt", () => {
  it("실제 제품 사진과 정보용 사진을 구분해 지시한다", () => {
    const prompt = buildOneShotPrompt([
      { role: "ACTUAL_PRODUCT", index: 0 },
      { role: "PACKAGING", index: 1 },
    ]);

    expect(prompt).toContain("이미지 1: 실제 제품 사진");
    expect(prompt).toContain("이미지 2: 포장 사진");
    expect(prompt).toContain("제품 형태로 생성하지 마세요");
  });

  it("제품 동일성 규칙(형태/구성품/색상/재질 변경 금지)을 항상 포함한다", () => {
    const prompt = buildOneShotPrompt([{ role: "UNKNOWN", index: 0 }]);

    expect(prompt).toContain("형태·구조·구성품 개수·색상·재질·크기 비율을 절대 바꾸지 마세요");
    expect(prompt).toContain("HTML");
  });
});
