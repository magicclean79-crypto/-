import {
  buildDraftProductAnalysis,
  type ProductAnalysisContext,
} from "../../analysis/product-analysis";
import type { PromptTemplate } from "../prompt-engine";

export const PRODUCT_ANALYSIS_TEMPLATE_KEY = "product-analysis";

/**
 * 상품 분석 프롬프트 템플릿. (TASK-0504, Sprint 5 — AI Execution)
 * 입력: ProductAnalysisContext (상품/OCR + Company Brain)
 * 출력 계약: ProductAnalysis 형태의 JSON 객체 하나
 *
 * 규칙 기반 초안(JSON)을 프롬프트에 포함한다 — 실제 모델은 초안을 검증·보강해
 * 최종 JSON을 만들고, mock LLM은 초안을 그대로 반환해 오프라인 검증을 지원한다.
 */
export const PRODUCT_ANALYSIS_TEMPLATE: PromptTemplate<ProductAnalysisContext> =
  {
    key: PRODUCT_ANALYSIS_TEMPLATE_KEY,
    name: "상품 분석",
    description:
      "상품 이미지 OCR 텍스트 + Company Brain 컨텍스트로 구조화된 상품 정보(ProductAnalysis JSON)를 추출한다",
    build(context) {
      const systemLines = [
        "너는 이커머스 상품 정보 분석 전문가다.",
        "상품 이미지에서 추출한 OCR 텍스트와 회사 지식(Company Brain)을 바탕으로 구조화된 상품 정보를 추출한다.",
        "출력 규칙:",
        "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
        "- 필드: name(상품 이름) · category(카테고리) · keywords(문자열 배열) · description(요약 설명) · attributes(문자열 값 객체) · confidence(0.0~1.0 숫자)",
        "- OCR 텍스트에 없는 정보를 만들어내지 않는다 — 불확실하면 confidence를 낮춘다",
        "- 회사 지식(Knowledge)의 브랜드·품질 규칙을 준수한다",
      ];

      const userSections: string[] = [];
      userSections.push(
        "## 상품 정보",
        `- 등록 이름: ${context.product.name}`,
        ...(context.product.description
          ? [`- 등록 설명: ${context.product.description}`]
          : []),
        `- 이미지 수: ${context.imageCount}`,
      );

      if (context.ocrTexts.length > 0) {
        userSections.push("", "## 이미지에서 추출한 텍스트 (OCR)");
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

      const draft = buildDraftProductAnalysis(context);
      userSections.push(
        "",
        "## 규칙 기반 초안 (검증·보강 대상)",
        "```json",
        JSON.stringify(draft, null, 2),
        "```",
        "",
        "위 초안을 OCR 텍스트·회사 지식에 근거해 검증·보강하여 최종 상품 분석 JSON 객체 하나만 출력해줘.",
      );

      return [
        { role: "system", content: systemLines.join("\n") },
        { role: "user", content: userSections.join("\n") },
      ];
    },
  };
