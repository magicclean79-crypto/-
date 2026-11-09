import { Logger } from "@nestjs/common";
import type { WebResearchProvider } from "./web-research-provider";
import { NoopWebResearchProvider } from "./providers/noop-web-research.provider";
import { OpenAiWebSearchProvider } from "./providers/openai-web-search.provider";

/**
 * `WEB_RESEARCH_PROVIDER` 환경 변수로 Provider를 선택한다. (기본: none)
 *
 * `LLM_PROVIDER`·`OCR_PROVIDER`와 같은 패턴(TASK-0903, TASK-2901) — 알 수
 * 없는 값이나 키 누락은 조용히 지나가지 않고 경고를 남긴 뒤 none(조사
 * 생략)으로 대체한다.
 *
 * 웹 조사는 실제 비용이 나가는 호출이다. **명시적으로 켠 경우에만 돈다**
 * (`AGENTS.md` 원칙 2 — 요금 발생 호출은 사전 승인, `docs/MASTER_GUIDE.md`
 * §4 — "웹 조사는 항상 하지 않는다").
 */
export function createWebResearchProvider(
  env: Record<string, string | undefined> = process.env,
): WebResearchProvider {
  const logger = new Logger("WebResearchProviderFactory");
  const name = (env.WEB_RESEARCH_PROVIDER ?? "none").trim().toLowerCase();

  if (name === "none" || name === "") {
    return new NoopWebResearchProvider();
  }

  if (name === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn(
        'WEB_RESEARCH_PROVIDER="openai"이지만 OPENAI_API_KEY가 없어 조사를 생략합니다.',
      );
      return new NoopWebResearchProvider();
    }
    return new OpenAiWebSearchProvider({ apiKey, model: env.WEB_RESEARCH_OPENAI_MODEL });
  }

  logger.warn(`알 수 없는 WEB_RESEARCH_PROVIDER "${name}" — 조사를 생략합니다.`);
  return new NoopWebResearchProvider();
}
