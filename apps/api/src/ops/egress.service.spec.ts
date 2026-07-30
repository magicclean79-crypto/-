import { EgressService } from "./egress.service";

/**
 * 도달 점검 어댑터 검증. (TASK-3501 — CTO 지시 2·3)
 *
 * 판정(막힌 것이 무엇을 뜻하는가)은 core가 하므로, 여기서는 **어댑터가
 * 사실을 그대로 넘기는지**를 본다: 인증 실패를 "막혔다"로 바꾸지 않는가,
 * 자격 증명을 흘리지 않는가, 볼 필요 없는 주소를 두드리지 않는가.
 */

const ORIGINAL = { ...process.env };

describe("EgressService (TASK-3501)", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    for (const name of [
      "LLM_PROVIDER",
      "OCR_PROVIDER",
      "S3_ENDPOINT",
      "OPENAI_API_KEY",
    ]) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  const service = () => new EgressService();

  describe("무엇을 점검할지", () => {
    it("아무것도 안 붙었으면 점검할 주소가 없다", () => {
      expect(service().hosts()).toEqual([]);
    });

    it("지금 고른 Provider의 공식 주소만 본다", () => {
      process.env.LLM_PROVIDER = "anthropic";
      expect(service().hosts()).toEqual(["api.anthropic.com"]);
    });

    it("mock이면 볼 주소가 없다 — 부르지 않는 곳을 점검할 이유가 없다", () => {
      process.env.LLM_PROVIDER = "mock";
      process.env.OCR_PROVIDER = "mock";
      expect(service().hosts()).toEqual([]);
    });

    it("google-vision을 쓰면 Vision 주소를 본다", () => {
      process.env.OCR_PROVIDER = "google-vision";
      expect(service().hosts()).toContain("vision.googleapis.com");
    });

    it("저장소는 공식 주소일 때만 본다 — s3rver는 볼 이유가 없다", () => {
      process.env.S3_ENDPOINT = "http://localhost:9000";
      expect(service().hosts()).toEqual([]);

      process.env.S3_ENDPOINT = "https://s3.ap-northeast-2.amazonaws.com";
      expect(service().hosts()).toEqual(["s3.ap-northeast-2.amazonaws.com"]);
    });
  });

  describe("무엇을 '닿았다'로 보는가", () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = "openai";
    });

    it("인증 실패도 닿은 것이다 — 우리가 보는 것은 길이지 권한이 아니다", async () => {
      fetchMock.mockResolvedValue({ status: 401 });
      const [probe] = await service().probe({ force: true });
      expect(probe.status).toBe("reachable");
      expect(probe.reachable).toBe(true);
      expect(probe.detail).toBe("HTTP 401");
    });

    it("403은 모른다고 말한다 — 프록시가 막은 것일 수도 있다", async () => {
      // 라이브에서 실제로 그랬다: api.openai.com의 403은 프록시였다
      fetchMock.mockResolvedValue({ status: 403 });
      const [probe] = await service().probe({ force: true });
      expect(probe.status).toBe("ambiguous");
      expect(probe.reachable).toBe(false);
      expect(probe.detail).toContain("가릴 수 없습니다");
    });

    it("프록시가 막으면 막힌 것이다", async () => {
      fetchMock.mockRejectedValue(
        new Error("CONNECT tunnel failed, response 403"),
      );
      const [probe] = await service().probe({ force: true });
      expect(probe.status).toBe("blocked");
      expect(probe.detail).toContain("CONNECT tunnel failed");
    });

    it("응답이 없으면 막힌 것으로 본다 — 무한정 기다리지 않는다", async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      fetchMock.mockRejectedValue(abort);
      const [probe] = await service().probe({ force: true });
      expect(probe.reachable).toBe(false);
      expect(probe.detail).toContain("안에 응답이 오지 않았습니다");
    });

    it("자격 증명을 보내지 않는다 — 도달만 보면 되고 키를 보내면 과금될 수 있다", async () => {
      process.env.OPENAI_API_KEY = "sk-super-secret";
      fetchMock.mockResolvedValue({ status: 200 });
      await service().probe({ force: true });
      const init = fetchMock.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      expect(JSON.stringify(init.headers)).not.toContain("sk-super-secret");
      expect(init.headers.authorization).toBeUndefined();
    });

    it("잠깐 사이에 다시 부르면 캐시를 쓴다 — 방화벽은 초 단위로 바뀌지 않는다", async () => {
      fetchMock.mockResolvedValue({ status: 200 });
      const instance = service();
      await instance.probe();
      await instance.probe();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
