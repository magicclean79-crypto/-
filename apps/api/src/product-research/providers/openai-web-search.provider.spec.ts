import { OpenAiWebSearchProvider, type OpenAiResponsesClient } from "./openai-web-search.provider";

describe("OpenAiWebSearchProvider — 실제 검색 인용만 결과로 인정한다", () => {
  it("url_citation 인용에서 URL·스니펫을 꺼낸다", async () => {
    const client: OpenAiResponsesClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "삼정크린마스터(주)는 경기도 김포시에 있는 생활용품 제조사다.",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://www.samjeongcm.co.kr",
                      title: "삼정크린마스터 공식 홈페이지",
                      start_index: 0,
                      end_index: 10,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    };
    const provider = new OpenAiWebSearchProvider({ apiKey: "test-key", client });

    const results = await provider.search({
      type: "brand",
      query: "삼정크린마스터(주)",
      reason: "브랜드",
    });

    expect(results).toEqual([
      {
        url: "https://www.samjeongcm.co.kr",
        title: "삼정크린마스터 공식 홈페이지",
        snippet: "삼정크린마스터(주)는 경기도 김포시에 있는 생활용품 제조사다.",
      },
    ]);
    expect(client.responses.create).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      input: "삼정크린마스터(주)",
      tools: [{ type: "web_search" }],
    });
  });

  it("인용(annotation) 없이 나온 텍스트는 버린다 — GPT의 기억을 사실처럼 쓰지 않는다", async () => {
    const client: OpenAiResponsesClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "아마 이런 회사일 것이다.", annotations: [] }],
            },
          ],
        }),
      },
    };
    const provider = new OpenAiWebSearchProvider({ apiKey: "test-key", client });

    const results = await provider.search({ type: "brand", query: "x", reason: "" });

    expect(results).toEqual([]);
  });

  it("같은 URL이 여러 번 인용돼도 한 번만 담는다", async () => {
    const client: OpenAiResponsesClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "삼정크린마스터는 삼정크린마스터다.",
                  annotations: [
                    { type: "url_citation", url: "https://www.samjeongcm.co.kr", title: "A" },
                    { type: "url_citation", url: "https://www.samjeongcm.co.kr", title: "A" },
                  ],
                },
              ],
            },
          ],
        }),
      },
    };
    const provider = new OpenAiWebSearchProvider({ apiKey: "test-key", client });

    const results = await provider.search({ type: "brand", query: "x", reason: "" });

    expect(results).toHaveLength(1);
  });

  it("message가 아닌 출력 항목(web_search_call 등)은 건너뛴다", async () => {
    const client: OpenAiResponsesClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output: [
            { type: "web_search_call" },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "공식 홈페이지입니다.",
                  annotations: [{ type: "url_citation", url: "https://www.samjeongcm.co.kr" }],
                },
              ],
            },
          ],
        }),
      },
    };
    const provider = new OpenAiWebSearchProvider({ apiKey: "test-key", client });

    const results = await provider.search({ type: "homepage", query: "x", reason: "" });

    expect(results).toHaveLength(1);
  });
});
