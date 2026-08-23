import { buildAnalysisPrompt, buildPageImagePrompt } from "./multi-page-prompt";

describe("buildAnalysisPrompt", () => {
  it("사진 개수·역할 분류·JSON 전용 출력을 지시한다", () => {
    const prompt = buildAnalysisPrompt(3);

    expect(prompt).toContain("이미지 3장");
    expect(prompt).toContain("ACTUAL_PRODUCT");
    expect(prompt).toContain("PACKAGING");
    expect(prompt).toContain("절대 추측하거나 지어내지 마세요");
    expect(prompt).toContain("4~6장");
    expect(prompt).toContain("HERO, FEATURES, USE, COMPONENTS");
  });

  it("sectionDescription을 사진·verifiedProductFacts에 근거해서만 쓰라고 지시한다(T1-196)", () => {
    const prompt = buildAnalysisPrompt(3);

    expect(prompt).toContain("sectionDescription");
    expect(prompt).toContain("사진에 없는 기능·성능·수치·효과를 만들어내지 마세요");
  });
});

describe("buildPageImagePrompt", () => {
  it("이 페이지의 역할·제목·designBrief를 그대로 포함한다", () => {
    const prompt = buildPageImagePrompt(
      {
        pageIndex: 2,
        pageRole: "FEATURES",
        title: "핵심 특징",
        designBrief: "구성품 클로즈업 샷",
        sectionDescription: "제품의 디테일을 보여줍니다.",
      },
      4,
    );

    expect(prompt).toContain("2/4번째");
    expect(prompt).toContain("FEATURES");
    expect(prompt).toContain("핵심 특징");
    expect(prompt).toContain("구성품 클로즈업 샷");
  });

  it("제품 동일성 규칙과 텍스트 렌더링 금지 규칙을 항상 포함한다", () => {
    const prompt = buildPageImagePrompt(
      { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x", sectionDescription: "y" },
      3,
    );

    expect(prompt).toContain("형태·구조·구성품 개수·색상·재질·크기 비율을 절대 바꾸지 마세요");
    expect(prompt).toContain("어떤 글자도 그려 넣지 마세요");
    expect(prompt).toContain("HTML");
  });
});
