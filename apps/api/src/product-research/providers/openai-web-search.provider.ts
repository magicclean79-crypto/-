import OpenAI from "openai";
import type { RawResearchResult, ResearchTarget } from "@acos/core";
import type { WebResearchProvider } from "../web-research-provider";

const DEFAULT_MODEL = "gpt-4o-mini";

interface WebSearchAnnotation {
  type: string;
  url?: string;
  title?: string | null;
  start_index?: number;
  end_index?: number;
}

interface WebSearchContentPart {
  type: string;
  text?: string;
  annotations?: WebSearchAnnotation[];
}

interface WebSearchOutputItem {
  type: string;
  content?: WebSearchContentPart[];
}

interface WebSearchResponse {
  output?: WebSearchOutputItem[];
}

/** 테스트에서 대체 가능한 최소 클라이언트 표면 (responses.create) */
export interface OpenAiResponsesClient {
  responses: {
    create: (params: {
      model: string;
      input: string;
      tools: [{ type: "web_search" }];
    }) => Promise<WebSearchResponse>;
  };
}

/** 인용 구간 주변 문맥을 스니펫으로 잘라낸다 — 답변 전체를 그대로 쓰지 않는다 */
function extractSnippet(text: string, start?: number, end?: number): string {
  if (typeof start !== "number" || typeof end !== "number" || !text) {
    return text.slice(0, 300).trim();
  }
  const margin = 120;
  const from = Math.max(0, start - margin);
  const to = Math.min(text.length, end + margin);
  return text.slice(from, to).trim();
}

/**
 * OpenAI의 웹 검색 도구(Responses API `web_search`)로 실제 검색을 수행한다.
 * (T1-22)
 *
 * **GPT의 기억이 아니라 실제 검색 결과만 쓴다.** 이 도구는 모델이 실시간
 * 검색을 실행하고, 답변에는 실제로 찾은 URL이 인용(`url_citation`)으로
 * 붙는다 — 이 어댑터는 그 인용 URL만 꺼내 돌려준다. 인용이 없는 문장(모델이
 * 검색 없이 "기억"으로 답했을 가능성이 있는 부분)은 버린다.
 *
 * 어떤 URL이 공식 출처인지 판정은 여기서 하지 않는다 — 그 뒤 단계
 * (`@acos/core`의 `classifyResearchSource`)가 판정한다. 이 어댑터는
 * "찾았다"만 말한다.
 */
export class OpenAiWebSearchProvider implements WebResearchProvider {
  readonly name = "openai";
  private readonly client: OpenAiResponsesClient;
  private readonly model: string;

  constructor(options: {
    apiKey: string;
    model?: string;
    /** 테스트 전용 — 미지정 시 공식 SDK 클라이언트 생성 */
    client?: OpenAiResponsesClient;
  }) {
    this.client =
      options.client ??
      (new OpenAI({ apiKey: options.apiKey }) as unknown as OpenAiResponsesClient);
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async search(target: ResearchTarget): Promise<RawResearchResult[]> {
    const response = await this.client.responses.create({
      model: this.model,
      input: target.query,
      tools: [{ type: "web_search" }],
    });

    const results: RawResearchResult[] = [];
    const seen = new Set<string>();
    for (const item of response.output ?? []) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        const text = part.text ?? "";
        for (const annotation of part.annotations ?? []) {
          if (annotation.type !== "url_citation" || !annotation.url) continue;
          if (seen.has(annotation.url)) continue;
          seen.add(annotation.url);
          results.push({
            url: annotation.url,
            title: annotation.title ?? null,
            snippet: extractSnippet(text, annotation.start_index, annotation.end_index),
          });
        }
      }
    }
    return results;
  }
}
