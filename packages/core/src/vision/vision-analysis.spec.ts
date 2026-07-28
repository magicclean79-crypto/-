import { createDefaultPromptEngine } from "../prompt/default-engine";
import { VISION_ANALYSIS_TEMPLATE_KEY } from "../prompt/templates/vision-analysis.template";
import {
  buildDraftVisionSummary,
  parseVisionSummaryResponse,
  VisionResponseParseError,
  type VisionAnalysisContext,
} from "./vision-analysis";

const emptyBrain: VisionAnalysisContext["companyBrain"] = {
  knowledge: [],
  decisions: [],
  memories: [],
};

const context: VisionAnalysisContext = {
  project: { name: "매직클린 걸레", description: "주방 청소 프로젝트" },
  ocrTexts: ["Magic Clean PVC Mat\nMade in Korea"],
  imageCount: 2,
  companyBrain: emptyBrain,
};

describe("buildDraftVisionSummary", () => {
  it("OCR 첫 줄 기반의 결정적 초안을 만든다", () => {
    expect(buildDraftVisionSummary(context)).toEqual({
      labels: ["Magic", "Clean", "PVC", "Mat"],
      brand: null,
      category: "미분류",
      suggestedTitle: "Magic Clean PVC Mat",
      confidence: 0.3,
    });
  });

  it("OCR이 없으면 프로젝트 이름, 그것도 없으면 대체 라벨을 쓴다", () => {
    const noOcr = buildDraftVisionSummary({ ...context, ocrTexts: [] });
    expect(noOcr.labels).toEqual(["매직클린", "걸레"]);
    expect(noOcr.suggestedTitle).toBe("매직클린 걸레");

    const nothing = buildDraftVisionSummary({
      ...context,
      ocrTexts: [],
      project: { name: "  ", description: null },
    });
    expect(nothing.labels).toEqual(["product"]);
    expect(nothing.suggestedTitle).toBeNull();
  });
});

describe("parseVisionSummaryResponse", () => {
  const valid = {
    labels: ["매트", "PVC"],
    brand: "MagicClean",
    category: "생활용품",
    suggestedTitle: "매직클린 PVC 매트",
    confidence: 0.9,
  };

  it("JSON 객체 응답을 VisionSummaryDraft로 파싱한다", () => {
    expect(parseVisionSummaryResponse(JSON.stringify(valid))).toEqual(valid);
  });

  it("코드 펜스·해설이 섞인 응답에서도 JSON을 추출한다", () => {
    const text = `분석 결과:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    expect(parseVisionSummaryResponse(text).labels).toEqual(valid.labels);
  });

  it("JSON을 찾을 수 없으면 VisionResponseParseError", () => {
    expect(() => parseVisionSummaryResponse("그냥 텍스트")).toThrow(
      VisionResponseParseError,
    );
  });

  it("labels가 없거나 비어 있으면 VisionResponseParseError", () => {
    expect(() =>
      parseVisionSummaryResponse(JSON.stringify({ brand: "X" })),
    ).toThrow("labels가 없습니다");
    expect(() =>
      parseVisionSummaryResponse(JSON.stringify({ labels: ["", 3] })),
    ).toThrow("labels가 없습니다");
  });

  it("나머지 필드는 안전한 기본값으로 보정한다", () => {
    expect(
      parseVisionSummaryResponse(
        JSON.stringify({ labels: [" 매트 "], brand: " ", confidence: -2 }),
      ),
    ).toEqual({
      labels: ["매트"],
      brand: null,
      category: null,
      suggestedTitle: null,
      confidence: 0,
    });
  });
});

describe("vision-analysis 템플릿", () => {
  const engine = createDefaultPromptEngine();

  it("기본 엔진에 등록되어 있다", () => {
    expect(engine.has(VISION_ANALYSIS_TEMPLATE_KEY)).toBe(true);
  });

  it("프로젝트/OCR/Company Brain과 초안 JSON을 담은 메시지를 렌더링한다", () => {
    const messages = engine.render(VISION_ANALYSIS_TEMPLATE_KEY, {
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
    expect(messages[0].content).toContain("이미지");
    expect(messages[1].content).toContain("매직클린 걸레");
    expect(messages[1].content).toContain("첨부 이미지 수: 2");
    expect(messages[1].content).toContain("Magic Clean PVC Mat");
    expect(messages[1].content).toContain("브랜드 표기");
    expect(messages[1].content).toContain("카테고리 정책");
    expect(messages[1].content).toContain('- tone: "간결"');

    const draftBlock = /```json\n([\s\S]*?)```/.exec(messages[1].content);
    expect(draftBlock).not.toBeNull();
    expect(JSON.parse(draftBlock![1]).labels).toEqual([
      "Magic",
      "Clean",
      "PVC",
      "Mat",
    ]);
  });

  it("렌더링은 결정적이다 — 같은 컨텍스트는 같은 메시지를 만든다", () => {
    expect(engine.render(VISION_ANALYSIS_TEMPLATE_KEY, context)).toEqual(
      engine.render(VISION_ANALYSIS_TEMPLATE_KEY, context),
    );
  });
});
