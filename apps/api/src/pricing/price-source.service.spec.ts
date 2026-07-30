import { PriceSourceService } from "./price-source.service";

/**
 * 외부 가격 공지 어댑터 검증. (TASK-3301 — CTO 정책 3301-①)
 *
 * 판정(무엇이 성공이고 무엇이 실패인가)은 core에서 검증하므로, 여기서는
 * **어댑터가 실패를 삼키지 않는지**를 본다: 네트워크 오류·타임아웃·HTTP
 * 오류·JSON 아님이 각각 판정으로 넘어가는가.
 */

const ORIGINAL = { ...process.env };

describe("PriceSourceService (TASK-3301)", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    process.env.PRICE_SOURCE_URL = "https://provider.example/pricing.json";
    delete process.env.PRICE_SOURCE_TOKEN;
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

  it("주소가 없으면 미구성이다 — 실패가 아니다", async () => {
    delete process.env.PRICE_SOURCE_URL;
    const verdict = await service().fetch();
    expect(verdict.status).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("읽으면 판정으로 넘긴다", async () => {
    respond([{ target: "ocr", key: "google-vision", perUnitUsd: 0.002 }]);
    const verdict = await service().fetch();
    expect(verdict.status).toBe("ok");
    expect(verdict.prices).toHaveLength(1);
  });

  it("HTTP 오류를 빈 목록으로 바꾸지 않는다", async () => {
    // 빈 목록으로 바꾸면 "변경 없음"이 되어 버린다 (정책 3301-①이 금지)
    respond(null, false, 503);
    const verdict = await service().fetch();
    expect(verdict.status).toBe("unreachable");
    expect(verdict.detail).toContain("HTTP 503");
    expect(verdict.needsHumanCheck).toBe(true);
  });

  it("네트워크 오류도 판정으로 넘긴다", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const verdict = await service().fetch();
    expect(verdict.status).toBe("unreachable");
    expect(verdict.detail).toContain("ECONNREFUSED");
  });

  it("시간이 지나면 못 읽은 것으로 본다 — 점검 전체를 멈추지 않는다", async () => {
    process.env.PRICE_SOURCE_TIMEOUT_MS = "10";
    const abort = new Error("aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);
    const verdict = await service().fetch();
    expect(verdict.status).toBe("unreachable");
    expect(verdict.detail).toContain("10ms 안에 응답이 오지 않았습니다");
  });

  it("JSON이 아니면 원문을 그대로 넘긴다 — 여기서 판단하지 않는다", async () => {
    respond("<html>Pricing</html>");
    const verdict = await service().fetch();
    expect(verdict.status).toBe("unparsable");
  });

  it("재시도하지 않는다 — 예약 점검이 다시 부른다", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await service().fetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("토큰은 헤더로만 보내고 판정 결과에 남기지 않는다", async () => {
    process.env.PRICE_SOURCE_TOKEN = "super-secret";
    respond([]);
    const verdict = await service().fetch();
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> })
      .headers;
    expect(headers.authorization).toBe("Bearer super-secret");
    // 주소는 밝히되 토큰은 어디에도 없다
    expect(JSON.stringify(verdict)).not.toContain("super-secret");
  });
});
