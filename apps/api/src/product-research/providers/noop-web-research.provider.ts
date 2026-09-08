import type { RawResearchResult } from "@acos/core";
import type { WebResearchProvider } from "../web-research-provider";

/**
 * 아무것도 조사하지 않는 기본 Provider. (T1-22)
 *
 * `WEB_RESEARCH_PROVIDER` 미설정 시 기본값이다 — 실 API 키가 없어도 항상
 * 기동하고, 비용도 나가지 않는다(`OcrModule`의 mock 기본값·`LlmModule`의
 * mock 기본값과 같은 원칙).
 *
 * `docs/MASTER_GUIDE.md` §4: "웹 조사는 항상 하지 않는다. OCR·Vision·바코드·
 * 모델명만으로 충분하면 생략한다" — 어떤 Provider를 켤지는 사람이 판단해
 * 환경변수로 정한다. 이 Provider가 기본인 이상, 웹 조사는 **명시적으로 켠
 * 경우에만** 실제로 돈다.
 */
export class NoopWebResearchProvider implements WebResearchProvider {
  readonly name = "none";

  async search(): Promise<RawResearchResult[]> {
    return [];
  }
}
