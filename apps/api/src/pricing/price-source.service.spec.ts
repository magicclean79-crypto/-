import { PriceSourceService } from "./price-source.service";

/**
 * 외부 가격 공지 어댑터 검증. (TASK-3301 — CTO 정책 3301-① · TASK-3401 결정 3301-⑤)
 *
 * 판정(무엇이 성공이고 무엇이 실패인가)은 core에서 검증하므로, 여기서는
 * **어댑터가 실패를 삼키지 않는지**를 본다: 네트워크 오류·타임아웃·HTTP
 * 오류·JSON 아님이 각각 판정으로 넘어가는가. TASK-3401부터는 **한 소스의
 * 실패가 다른 소스를 막지 않는지**도 함께 본다.
 */

const ORIGINAL = { ...process.env };

describe("PriceSourceService (TASK-3301)", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("PRICE_SOURCE_")) {
        delete process.env[name];
      }
    }
    process.env.PRICE_SOURCE_URL = "https://provider.example/pricing.json";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  const service = () => new PriceSourceService();

  const respond = (body: unknown, ok = true, status = 200) => {
    fetchMock.mockResolvedValue({
      ok,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    });
  };

  /** 소스 1곳만 설정된 경우의 판정 */
  const first = async () => (await service().fetchAll())[0].verdict;

  it("주소가 없으면 읽을 소스가 없다 — 미구성이며 실패가 아니다", async () => {
    delete process.env.PRICE_SOURCE_URL;
    expect(await service().fetchAll()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("읽으면 판정으로 넘긴다", async () => {
    respond([{ target: "ocr", key: "google-vision", perUnitUsd: 0.002 }]);
    const verdict = await first();
    expect(verdict.status).toBe("ok");
    expect(verdict.prices).toHaveLength(1);
  });

  it("HTTP 오류를 빈 목록으로 바꾸지 않는다", async () => {
    // 빈 목록으로 바꾸면 "변경 없음"이 되어 버린다 (정책 3301-①이 금지)
    respond(null, false, 503);
    const verdict = await first();
    expect(verdict.status).toBe("unreachable");
    expect(verdict.detail).toContain("HTTP 503");
    expect(verdict.needsHumanCheck).toBe(true);
  });

  it("네트워크 오류도 판정으로 넘긴다", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await first()).detail).toContain("ECONNREFUSED");
  });

  it("시간이 지나면 못 읽은 것으로 본다 — 점검 전체를 멈추지 않는다", async () => {
    process.env.PRICE_SOURCE_TIMEOUT_MS = "10";
    const abort = new Error("aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);
    const verdict = await first();
    expect(verdict.status).toBe("unreachable");
    expect(verdict.detail).toContain("10ms 안에 응답이 오지 않았습니다");
  });

  it("JSON이 아니면 원문을 그대로 넘긴다 — 여기서 판단하지 않는다", async () => {
    respond("<html>Pricing</html>");
    expect((await first()).status).toBe("unparsable");
  });

  it("재시도하지 않는다 — 예약 점검이 다시 부른다", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await service().fetchAll();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("토큰은 헤더로만 보내고 판정 결과에 남기지 않는다", async () => {
    process.env.PRICE_SOURCE_TOKEN = "super-secret";
    respond([]);
    const results = await service().fetchAll();
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> })
      .headers;
    expect(headers.authorization).toBe("Bearer super-secret");
    // 주소는 밝히되 토큰은 어디에도 없다
    expect(JSON.stringify(results)).not.toContain("super-secret");
  });

  describe("Provider별 공지 (TASK-3401, CTO 결정 3301-⑤)", () => {
    beforeEach(() => {
      delete process.env.PRICE_SOURCE_URL;
      process.env.PRICE_SOURCE_URL_OPENAI = "https://openai.example/p.json";
      process.env.PRICE_SOURCE_URL_GOOGLE = "https://google.example/p.json";
    });

    it("소스마다 따로 읽고 따로 판정한다", async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.includes("openai")
          ? { ok: false, status: 503, text: async () => "" }
          : {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify([
                  { target: "ocr", key: "google-vision", perUnitUsd: 0.002 },
                ]),
            },
      );

      const results = await service().fetchAll();
      const byId = Object.fromEntries(results.map((row) => [row.id, row.verdict]));
      // 한 곳이 죽어도 나머지는 읽힌다 — 이것이 소스를 나눈 이유다
      expect(byId.openai.status).toBe("unreachable");
      expect(byId.google.status).toBe("ok");
      expect(byId.google.prices).toHaveLength(1);
    });

    it("Provider별 토큰을 그 소스에만 보낸다", async () => {
      process.env.PRICE_SOURCE_TOKEN_OPENAI = "openai-secret";
      respond([]);
      await service().fetchAll();

      const calls = fetchMock.mock.calls as [
        string,
        { headers: Record<string, string> },
      ][];
      const openai = calls.find(([url]) => url.includes("openai"))![1].headers;
      const google = calls.find(([url]) => url.includes("google"))![1].headers;
      expect(openai.authorization).toBe("Bearer openai-secret");
      expect(google.authorization).toBeUndefined();
    });

    it("형식이 다른 공지도 같은 판정으로 넘어온다", async () => {
      process.env.PRICE_SOURCE_FORMAT_OPENAI = "flat";
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          url.includes("openai")
            ? JSON.stringify({ models: { "gpt-4o": { input: 2.5, output: 10 } } })
            : JSON.stringify([
                { target: "ocr", key: "google-vision", perUnitUsd: 0.002 },
              ]),
      }));

      const results = await service().fetchAll();
      for (const row of results) {
        expect(row.verdict.status).toBe("ok");
        expect(row.verdict.prices).toHaveLength(1);
      }
    });

    it("거부한 설정을 조용히 버리지 않는다", () => {
      process.env.PRICE_SOURCE_URL_PROJECT_ACME = "https://acme.example/p.json";
      const rejected = service().rejected;
      expect(rejected.map((row) => row.name)).toContain("PRICE_SOURCE_URL_PROJECT_ACME");
    });
  });
});
