import type { ContentGenerationContext } from "../../content-generation/content-generation";
import type { PromptTemplate } from "../prompt-engine";

/**
 * 상세페이지 생성 프롬프트 템플릿. (TASK-0502에서 분리 — TASK-0503)
 * 입력: ContentGenerationContext (READY Product Object + Company Brain)
 */
export const CONTENT_GENERATION_TEMPLATE: PromptTemplate<ContentGenerationContext> =
  {
    key: "content-generation",
    name: "상세페이지 생성",
    description:
      "READY Product Object + Company Brain 컨텍스트로 Markdown 상세페이지를 생성한다",
    build(context) {
      const { productObject, companyBrain } = context;

      const systemLines = [
        "너는 이커머스 상세페이지 전문 카피라이터다.",
        "주어진 상품 정보와 회사 지식(Company Brain)을 바탕으로 한국어 Markdown 상세페이지를 작성한다.",
        "출력 규칙:",
        "- Markdown 본문만 출력한다 (코드 펜스·해설·머리말 금지)",
        "- 첫 줄은 `# 상품명` 형태의 제목이어야 한다",
        "- 확인되지 않은 효능·최상급 표현을 만들어내지 않는다",
      ];
      if (companyBrain.bannedWords && companyBrain.bannedWords.length > 0) {
        systemLines.push(
          `- 다음 금지어는 절대 사용하지 않는다: ${companyBrain.bannedWords.join(", ")}`,
        );
      }

      const userSections: string[] = [];
      userSections.push(
        "## 상품 정보 (READY Product Object)",
        `- 제목: ${productObject.title}`,
        `- 브랜드: ${productObject.brand ?? "-"}`,
        `- 카테고리: ${productObject.category ?? "-"}`,
        `- 버전: v${productObject.version}`,
      );
      const attributeEntries = Object.entries(productObject.attributes);
      if (attributeEntries.length > 0) {
        userSections.push(
          "- 속성:",
          ...attributeEntries.map(([key, value]) => `  - ${key}: ${value}`),
        );
      }
      if (productObject.ocrText) {
        userSections.push(
          "",
          "## 이미지에서 추출한 텍스트 (OCR)",
          productObject.ocrText,
        );
      }
      if (productObject.visionLabels.length > 0) {
        userSections.push(
          "",
          "## 이미지 분석 라벨 (Vision)",
          productObject.visionLabels.join(", "),
        );
      }
      userSections.push(
        "",
        `## 프로젝트`,
        `- 이름: ${context.project.name}`,
        ...(context.project.description
          ? [`- 설명: ${context.project.description}`]
          : []),
      );

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

      userSections.push(
        "",
        "위 정보로 구매 전환을 이끄는 상세페이지 Markdown을 작성해줘.",
      );

      return [
        { role: "system", content: systemLines.join("\n") },
        { role: "user", content: userSections.join("\n") },
      ];
    },
  };
