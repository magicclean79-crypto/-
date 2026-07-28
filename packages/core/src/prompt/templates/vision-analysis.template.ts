import {
  buildDraftVisionSummary,
  type VisionAnalysisContext,
} from "../../vision/vision-analysis";
import type { PromptTemplate } from "../prompt-engine";

export const VISION_ANALYSIS_TEMPLATE_KEY = "vision-analysis";

/**
 * Vision 이미지 분석 프롬프트 템플릿. (TASK-0505, Sprint 5 — AI Execution)
 * 입력: VisionAnalysisContext (프로젝트/OCR + Company Brain)
 * 출력 계약: VisionSummaryDraft(labels/brand/category/suggestedTitle/confidence)
 *            형태의 JSON 객체 하나 — source는 Provider가 채운다
 *
 * 이미지 바이트는 이 템플릿이 아니라 LLM Gateway 요청의 images(멀티모달
 * 첨부)로 전달된다. 규칙 기반 초안 JSON을 포함해 실제 모델은 이미지를 보고
 * 검증·보강하고, mock LLM은 초안을 그대로 반환해 오프라인 검증을 지원한다.
 */
export const VISION_ANALYSIS_TEMPLATE: PromptTemplate<VisionAnalysisContext> = {
  key: VISION_ANALYSIS_TEMPLATE_KEY,
  name: "Vision 이미지 분석",
  description:
    "첨부된 상품 이미지 + OCR + Company Brain 컨텍스트로 VisionSummary JSON(labels/brand/category/suggestedTitle/confidence)을 추출한다",
  build(context) {
    const systemLines = [
      "너는 이커머스 상품 이미지 분석 전문가다.",
      "이 요청에 첨부된 상품 이미지들을 직접 보고, 참고용 OCR 텍스트·회사 지식(Company Brain)과 함께 시각 정보를 추출한다.",
      "출력 규칙:",
      "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
      "- 필드: labels(이미지에서 보이는 것들의 문자열 배열) · brand(문자열 또는 null) · category(문자열 또는 null) · suggestedTitle(문자열 또는 null) · confidence(0.0~1.0 숫자)",
      "- 이미지에서 확인되지 않는 정보를 만들어내지 않는다 — 불확실하면 null로 두고 confidence를 낮춘다",
      "- 회사 지식(Knowledge)의 브랜드·품질 규칙을 준수한다",
    ];

    const userSections: string[] = [];
    userSections.push(
      "## 프로젝트 정보",
      `- 이름: ${context.project.name}`,
      ...(context.project.description
        ? [`- 설명: ${context.project.description}`]
        : []),
      `- 첨부 이미지 수: ${context.imageCount} (이미지는 이 요청에 직접 첨부되어 있다)`,
    );

    if (context.ocrTexts.length > 0) {
      userSections.push("", "## 참고용 OCR 텍스트");
      context.ocrTexts.forEach((text, index) => {
        userSections.push(`### 이미지 ${index + 1}`, text);
      });
    }

    const { companyBrain } = context;
    if (companyBrain.knowledge.length > 0) {
      userSections.push("", "## 회사 지식 (Knowledge — 반드시 준수)");
      companyBrain.knowledge.forEach((item) => {
        userSections.push(
          `- [${item.category ?? "-"}] ${item.title}: ${item.content}`,
        );
      });
    }
    if (companyBrain.decisions.length > 0) {
      userSections.push("", "## 관련 결정 (Decision)");
      companyBrain.decisions.forEach((item) => {
        userSections.push(`- ${item.title} (근거: ${item.reason})`);
      });
    }
    if (companyBrain.memories.length > 0) {
      userSections.push("", "## 관련 설정 (Memory)");
      companyBrain.memories.forEach((item) => {
        userSections.push(
          `- ${item.key}: ${JSON.stringify(item.value)}` +
            (item.description ? ` (${item.description})` : ""),
        );
      });
    }

    const draft = buildDraftVisionSummary(context);
    userSections.push(
      "",
      "## 규칙 기반 초안 (검증·보강 대상)",
      "```json",
      JSON.stringify(draft, null, 2),
      "```",
      "",
      "첨부된 이미지를 직접 확인해 위 초안을 검증·보강하여 최종 Vision 분석 JSON 객체 하나만 출력해줘.",
    );

    return [
      { role: "system", content: systemLines.join("\n") },
      { role: "user", content: userSections.join("\n") },
    ];
  },
};
