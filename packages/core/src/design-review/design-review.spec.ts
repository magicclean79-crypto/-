import { createDefaultPromptEngine } from "../prompt/default-engine";
import { DESIGN_REVIEW_TEMPLATE_KEY } from "../prompt/templates/design-review.template";
import {
  DesignReviewParseError,
  parseDesignReviewResponse,
  type DesignReviewContext,
} from "./design-review";

const context: DesignReviewContext = {
  category: "캠핑용품",
  notes: "이 화면은 Template V1 시안이다",
  imageCount: 1,
};

describe("parseDesignReviewResponse", () => {
  const valid = {
    layout: "Hero → 구매포인트 → 특징 → 스펙 순서",
    typography: "제목 20px, 본문 13px, 줄간격 1.5",
    whitespace: "섹션 간 여백이 충분함",
    imagePlacement: "Hero 사진이 화면 상단 40%를 차지",
    colorUsage: "인디고 포인트 컬러 사용",
    visualHierarchy: "제목 → 사진 → 특징 순으로 시선이 이동함",
    purchaseMotivation: "구매 포인트 칩이 눈에 잘 들어옴",
    mobileUx: "480px 기준으로 스크롤이 자연스러움",
    strengths: ["사진 활용이 좋음"],
    improvements: ["스펙표 폰트가 작음"],
    overallScore: 78,
    summary: "전반적으로 쇼핑몰 상세페이지에 근접한 수준",
  };

  it("JSON 객체 응답을 DesignReviewResult로 파싱한다", () => {
    expect(parseDesignReviewResponse(JSON.stringify(valid))).toEqual(valid);
  });

  it("코드 펜스·해설이 섞인 응답에서도 JSON을 추출한다", () => {
    const text = `평가입니다.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n감사합니다.`;
    expect(parseDesignReviewResponse(text).summary).toBe(valid.summary);
  });

  it("JSON을 찾을 수 없으면 DesignReviewParseError", () => {
    expect(() => parseDesignReviewResponse("그냥 텍스트")).toThrow(DesignReviewParseError);
    expect(() => parseDesignReviewResponse("[1, 2]")).toThrow(DesignReviewParseError);
  });

  it("summary가 없으면 DesignReviewParseError", () => {
    expect(() => parseDesignReviewResponse(JSON.stringify({ layout: "x" }))).toThrow(
      DesignReviewParseError,
    );
  });

  it("서술형 필드가 비어 있으면 '평가 없음'으로 보정한다", () => {
    const result = parseDesignReviewResponse(JSON.stringify({ summary: "총평만 있음" }));
    expect(result.layout).toBe("평가 없음");
    expect(result.strengths).toEqual([]);
    expect(result.overallScore).toBe(50);
  });

  it("overallScore는 0~100으로 클램프한다", () => {
    expect(
      parseDesignReviewResponse(JSON.stringify({ summary: "x", overallScore: 150 })).overallScore,
    ).toBe(100);
    expect(
      parseDesignReviewResponse(JSON.stringify({ summary: "x", overallScore: -10 })).overallScore,
    ).toBe(0);
  });
});

describe("design-review 템플릿", () => {
  const engine = createDefaultPromptEngine();

  it("기본 엔진에 등록되어 있다", () => {
    expect(engine.has(DESIGN_REVIEW_TEMPLATE_KEY)).toBe(true);
  });

  it("카테고리·맥락·이미지 수를 담은 메시지를 렌더링한다 — Company Brain 의존 없음", () => {
    const messages = engine.render(DESIGN_REVIEW_TEMPLATE_KEY, context);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("JSON 객체 하나만 출력");
    expect(messages[1].content).toContain("캠핑용품");
    expect(messages[1].content).toContain("Template V1 시안");
  });

  it("notes가 없으면 참고 맥락 섹션을 생략한다", () => {
    const messages = engine.render(DESIGN_REVIEW_TEMPLATE_KEY, {
      category: "생활용품",
      imageCount: 2,
    });
    expect(messages[1].content).not.toContain("참고 맥락");
  });

  it("렌더링은 결정적이다", () => {
    expect(engine.render(DESIGN_REVIEW_TEMPLATE_KEY, context)).toEqual(
      engine.render(DESIGN_REVIEW_TEMPLATE_KEY, context),
    );
  });
});
