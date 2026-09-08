import type { RawResearchResult, ResearchTarget } from "@acos/core";

/** `WEB_RESEARCH_PROVIDER` DI 토큰 — `LLM_PROVIDER`·`OCR_PROVIDER`와 같은 패턴 */
export const WEB_RESEARCH_PROVIDER = Symbol("WEB_RESEARCH_PROVIDER");

/**
 * 웹 조사 Provider 포트. (T1-22)
 *
 * 구현체는 **실제 검색으로 찾은 URL만** 돌려줘야 한다 — GPT에게 "아는 것"을
 * 묻는 방식은 이 포트의 계약을 어기는 것이다(`docs/PROJECT_MEMORY.md` M-21:
 * "GPT에게 '아는 것'을 묻는 방식은 쓰지 않는다").
 *
 * 어떤 URL이 공식 출처인지 판정은 여기서 하지 않는다 — `@acos/core`의
 * `classifyResearchSource`/`filterOfficialResults`가 판정한다. 이 포트는
 * "찾았다"만 말하고 "믿을 수 있다"는 말하지 않는다.
 */
export interface WebResearchProvider {
  readonly name: string;
  search(target: ResearchTarget): Promise<RawResearchResult[]>;
}
