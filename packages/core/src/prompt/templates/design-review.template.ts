import type { DesignReviewContext } from "../../design-review/design-review";
import type { PromptTemplate } from "../prompt-engine";

export const DESIGN_REVIEW_TEMPLATE_KEY = "design-review";

/**
 * 디자인 리뷰 프롬프트 템플릿. (Sprint 35 — "시장 디자인 패턴 학습" CTO 지시)
 *
 * CTO 역할 분담: Claude는 엔진·HTML·Vision·Product Profile을, **디자인
 * 평가는 Gemini(또는 다른 멀티모달 Provider)**가 맡는다. 이 템플릿은 그
 * 평가 요청의 내용을 정의한다 — 레이아웃·타이포그래피·여백·사진배치·
 * 색상·시선흐름·구매유도력·모바일UX 8가지를 요구한다.
 *
 * 이미지(스크린샷)는 이 템플릿이 아니라 LLM Gateway 요청의 images(멀티모달
 * 첨부)로 전달된다 — vision-analysis/product-feature-vision과 같은 원칙.
 */
export const DESIGN_REVIEW_TEMPLATE: PromptTemplate<DesignReviewContext> = {
  key: DESIGN_REVIEW_TEMPLATE_KEY,
  name: "디자인 리뷰",
  description:
    "상세페이지 스크린샷을 레이아웃·타이포그래피·여백·사진배치·색상·시선흐름·구매유도력·모바일UX 관점에서 평가한다",
  build(context) {
    const systemLines = [
      "너는 이커머스 상세페이지 전문 디자인 디렉터다.",
      "첨부된 화면(스크린샷)을 실제 디자이너가 검토하듯 근거를 들어 평가한다.",
      "출력 규칙:",
      "- 모든 서술형 값은 한국어로 작성한다",
      "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
      "- 필드: layout(레이아웃 구조) · typography(폰트·크기·줄간격) · " +
        "whitespace(여백) · imagePlacement(사진 배치·크기·비율) · " +
        "colorUsage(색상 사용) · visualHierarchy(시선 흐름) · " +
        "purchaseMotivation(구매 유도력) · mobileUx(모바일 사용성) · " +
        "strengths(잘된 점 배열) · improvements(개선점 배열) · " +
        "overallScore(0~100 완성도) · summary(총평, 필수)",
      "- 화면에서 확인할 수 없는 것은 지어내지 말고 '확인 어려움'이라고 적는다",
      "- 막연한 칭찬이 아니라 구체적인 근거(위치·크기·색상 등)를 들어 평가한다",
    ];

    const userSections: string[] = [
      `## 카테고리: ${context.category}`,
      `## 첨부된 화면 수: ${context.imageCount}`,
    ];
    if (context.notes) {
      userSections.push("", "## 참고 맥락", context.notes);
    }
    userSections.push(
      "",
      "첨부된 화면을 직접 보고 위 8개 항목 + 총평을 담은 JSON 객체 하나만 출력해줘.",
    );

    return [
      { role: "system", content: systemLines.join("\n") },
      { role: "user", content: userSections.join("\n") },
    ];
  },
};
