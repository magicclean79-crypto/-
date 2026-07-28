import type { LlmMessageDto } from "@acos/shared";

/**
 * Prompt Engine — 프롬프트 생성의 단일 엔진. (TASK-0503, Sprint 5 — AI Execution)
 *
 * 프롬프트 생성 로직을 각 기능(Content Generation 등)에서 분리해
 * **선언적 템플릿 + 렌더링 엔진**으로 관리한다. 향후 모든 AI 기능은
 * 자신의 PromptTemplate을 등록하고 이 엔진의 render()로만 프롬프트를 만든다
 * — LLM Gateway(호출)와 짝을 이루는 프롬프트 계층.
 * 자세한 구조: docs/architecture/prompt.md
 */
export interface PromptTemplate<TInput = unknown> {
  /** 템플릿 식별자 (예: "content-generation") — 엔진 내 유니크 */
  key: string;
  name: string;
  description: string;
  /** 입력 컨텍스트를 LLM Gateway 메시지로 렌더링한다 */
  build(input: TInput): LlmMessageDto[];
}

export class PromptEngine {
  private readonly templates = new Map<string, PromptTemplate<unknown>>();

  constructor(templates: PromptTemplate<unknown>[]) {
    for (const template of templates) {
      if (this.templates.has(template.key)) {
        throw new Error(
          `중복된 프롬프트 템플릿 key입니다: ${template.key}`,
        );
      }
      this.templates.set(template.key, template);
    }
  }

  has(key: string): boolean {
    return this.templates.has(key);
  }

  /** 등록된 템플릿 목록 (key/name/description) */
  list(): { key: string; name: string; description: string }[] {
    return [...this.templates.values()].map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
    }));
  }

  /** 템플릿 key로 프롬프트를 렌더링한다 — 미등록 key는 오류 */
  render<TInput>(key: string, input: TInput): LlmMessageDto[] {
    const template = this.templates.get(key);
    if (!template) {
      throw new Error(
        `등록되지 않은 프롬프트 템플릿입니다: ${key} ` +
          `(등록됨: ${[...this.templates.keys()].join(", ") || "없음"})`,
      );
    }
    return (template as PromptTemplate<TInput>).build(input);
  }
}
