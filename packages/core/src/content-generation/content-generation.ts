/**
 * Content Generation Engine — 컨텍스트 정의·후처리. (TASK-0502)
 *
 * READY Product Object + Company Brain 컨텍스트 타입과 생성 결과 후처리를
 * 담당한다. **프롬프트 생성은 TASK-0503에서 Prompt Engine으로 분리됨** —
 * 템플릿 key `content-generation` (packages/core/src/prompt/templates/).
 * 데이터 수집(READY 검증·Company Brain 조회·LLM 호출·Content 저장)은
 * API 계층이 담당한다. 자세한 구조: docs/architecture/content-generation.md
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
