import type { LlmMessageDto } from "@acos/shared";

/**
 * Content Generation Engine — 프롬프트 조립. (TASK-0502, Sprint 5 — AI Execution)
 *
 * READY Product Object + Company Brain 컨텍스트를 LLM Gateway가 소비할
 * 메시지로 조립한다. 데이터 수집(READY 검증·Company Brain 조회·LLM 호출·
 * Content 저장)은 API 계층이, 프롬프트 구성 규칙은 이 모듈이 담당한다.
 * 자세한 구조: docs/architecture/content-generation.md
 */
export interface ContentGenerationContext {
  project: {
    name: string;
    description: string | null;
  };
  productObject: {
    version: number;
    title: string;
    brand: string | null;
    category: string | null;
    attributes: Record<string, string>;
    /** OCR 요약 combinedText (없으면 null) */
    ocrText: string | null;
    /** Vision 분석 라벨 (없으면 빈 배열) */
    visionLabels: string[];
  };
  companyBrain: {
    /** 제목 검색으로 찾은 관련 지식 (RULE/GUIDE/BRAND 등) */
    knowledge: { title: string; content: string; category: string | null }[];
    /** 관련 프로젝트 결정 */
    decisions: { title: string; reason: string }[];
    /** 관련 구조화 설정 (표준 Memory) */
    memories: { key: string; value: unknown; description: string | null }[];
    /** 금지어 목록 (Memory GLOBAL banned-words, 미설정이면 null) */
    bannedWords: string[] | null;
  };
}

/** LLM Gateway에 보낼 메시지 조립 — system(작성 규칙) + user(구조화 정보) */
export function buildContentGenerationMessages(
  context: ContentGenerationContext,
): LlmMessageDto[] {
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
    userSections.push("", "## 이미지에서 추출한 텍스트 (OCR)", productObject.ocrText);
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
      userSections.push(`- [${item.category ?? "-"}] ${item.title}: ${item.content}`);
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
}

/**
 * 생성된 Markdown에서 제목을 추출한다 — 첫 `# 헤딩` 우선,
 * 없으면 fallback("<상품명> 상세페이지")을 쓴다.
 */
export function extractMarkdownTitle(
  markdown: string,
  fallback: string,
): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : fallback;
}
