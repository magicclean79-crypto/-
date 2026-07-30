import {
  GOOGLE_VISION_DEFAULT_ENDPOINT,
  GoogleVisionOcrProvider,
  averagePageConfidence,
} from "./google-vision.provider";
import type { GoogleVisionFetch } from "./google-vision.provider";

const KEY = `AIza${"k".repeat(31)}`;
const IMAGE = new Uint8Array([1, 2, 3, 4]);

/** 응답을 고정하는 스텁 — 요청 내용을 기록한다 */
function stub(
  status: number,
  body: unknown,
): { fetchFn: GoogleVisionFetch; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const fetchFn: GoogleVisionFetch = async (url, init) => {
    calls.push({ url, body: init.body });
    return {
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  return { fetchFn, calls };
}

const ok = (text: string, pages?: unknown) => ({
  responses: [{ fullTextAnnotation: { text, ...(pages ? { pages } : {}) } }],
});

function build(
  status: number,
  body: unknown,
  options: Partial<{ endpoint: string; languageHints: string[] }> = {},
) {
  const { fetchFn, calls } = stub(status, body);
  return {
    calls,
    provider: new GoogleVisionOcrProvider({ apiKey: KEY, fetchFn, ...options }),
  };
}

describe("GoogleVisionOcrProvider (TASK-2901, CTO 결정 2801-⑤)", () => {
  describe("키가 없으면 만들지 않는다", () => {
    it("생성 시점에 실패한다 — 첫 호출까지 기다리지 않는다", () => {
      // 첫 호출에서 실패하면 그때는 이미 이미지가 올라간 뒤다
      expect(() => new GoogleVisionOcrProvider({ apiKey: "" })).toThrow(
        /GOOGLE_VISION_API_KEY/,
      );
      expect(() => new GoogleVisionOcrProvider({ apiKey: "   " })).toThrow();
    });
  });

  describe("요청", () => {
    it("공식 엔드포인트에 TEXT_DETECTION으로 base64 이미지를 보낸다", async () => {
      const { provider, calls } = build(200, ok("매직클린"));
      await provider.recognize(IMAGE, "image/png");

      expect(calls).toHaveLength(1);
      expect(calls[0].url.startsWith(GOOGLE_VISION_DEFAULT_ENDPOINT)).toBe(true);
      const payload = JSON.parse(calls[0].body);
      expect(payload.requests[0].features).toEqual([{ type: "TEXT_DETECTION" }]);
      expect(payload.requests[0].image.content).toBe(
        Buffer.from(IMAGE).toString("base64"),
      );
    });

    it("언어 힌트를 주면 imageContext로 싣고, 없으면 넣지 않는다", async () => {
      const withHints = build(200, ok("텍스트"), { languageHints: ["ko", "en"] });
      await withHints.provider.recognize(IMAGE, "image/png");
      expect(
        JSON.parse(withHints.calls[0].body).requests[0].imageContext,
      ).toEqual({ languageHints: ["ko", "en"] });

      const without = build(200, ok("텍스트"), { languageHints: [] });
      await without.provider.recognize(IMAGE, "image/png");
      expect(
        JSON.parse(without.calls[0].body).requests[0].imageContext,
      ).toBeUndefined();
    });

    it("엔드포인트를 바꿔도 계약은 같다 (스테이징 프록시·계약 검증)", async () => {
      const { provider, calls } = build(200, ok("텍스트"), {
        endpoint: "http://127.0.0.1:9100/v1/images:annotate",
      });
      await provider.recognize(IMAGE, "image/png");
      expect(calls[0].url.startsWith("http://127.0.0.1:9100/")).toBe(true);
    });
  });

  describe("신뢰도를 지어내지 않는다", () => {
    it("Provider가 주면 페이지 평균으로 쓴다", async () => {
      const { provider } = build(
        200,
        ok("매직클린", [{ confidence: 0.9 }, { confidence: 0.7 }]),
      );
      expect((await provider.recognize(IMAGE, "image/png")).confidence).toBe(0.8);
    });

    it("주지 않으면 null이다 — 1.0도 0도 아니다", async () => {
      // 1.0으로 채우면 "확신한다"는 거짓이고, 0으로 채우면 실패처럼 읽힌다
      const { provider } = build(200, ok("매직클린"));
      expect((await provider.recognize(IMAGE, "image/png")).confidence).toBeNull();
    });

    it("범위를 벗어난 값은 0~1로 가둔다", () => {
      expect(averagePageConfidence([{ confidence: 1.4 }])).toBe(1);
      expect(averagePageConfidence([{ confidence: -0.2 }])).toBe(0);
      expect(averagePageConfidence([{ confidence: "높음" }])).toBeNull();
      expect(averagePageConfidence(undefined)).toBeNull();
    });
  });

  describe("글자가 없는 것과 응답을 못 읽은 것은 다르다", () => {
    it("텍스트 감지 결과가 없으면 빈 텍스트로 성공한다", async () => {
      // 글자가 없는 이미지는 정상 결과다
      const { provider } = build(200, { responses: [{}] });
      const result = await provider.recognize(IMAGE, "image/png");
      expect(result.text).toBe("");
      expect(result.confidence).toBeNull();
      expect(result.raw).toMatchObject({ empty: true });
    });

    it("JSON이 아니면 실패한다 — 빈 텍스트로 넘기지 않는다", async () => {
      // 빈 텍스트로 성공 처리하면 OCR이 성공했다고 기록되고 상품이 빈
      // 재료로 조립된다
      const { provider } = build(200, "<html>not json</html>");
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        /JSON으로 읽을 수 없습니다/,
      );
    });

    it("responses가 없으면 실패한다", async () => {
      const { provider } = build(200, { ok: true });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        /responses가 없습니다/,
      );
    });

    it("200인데 본문에 error가 오면 성공으로 세지 않는다", async () => {
      const { provider } = build(200, {
        responses: [{ error: { message: "Bad image data" } }],
      });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        /Bad image data/,
      );
    });

    it("text가 문자열이 아니면 실패한다", async () => {
      const { provider } = build(200, {
        responses: [{ fullTextAnnotation: { text: 42 } }],
      });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        /문자열이 아닙니다/,
      );
    });
  });

  describe("오류를 한 덩어리로 뭉치지 않는다", () => {
    const cases: [number, RegExp][] = [
      [400, /이미지 형식·크기를 확인하세요/],
      [401, /인증 실패/],
      [403, /인증 실패/],
      [429, /할당량 초과/],
      [500, /장애 \(500\) — 우리 설정 문제가 아닙니다/],
      [418, /호출 실패 \(418\)/],
    ];

    it.each(cases)("%i은 사람이 할 일을 말한다", async (status, pattern) => {
      const { provider } = build(status, {
        error: { message: "detail from google" },
      });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        pattern,
      );
    });

    it("Google 오류 메시지를 그대로 덧붙인다", async () => {
      const { provider } = build(403, {
        error: { message: "API key not valid" },
      });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        /API key not valid/,
      );
    });

    it("네트워크 실패와 Google이 답을 준 실패를 구분한다", async () => {
      const provider = new GoogleVisionOcrProvider({
        apiKey: KEY,
        fetchFn: async () => {
          throw new Error("ECONNREFUSED");
        },
      });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        /연결할 수 없습니다/,
      );
    });
  });

  describe("키를 남기지 않는다", () => {
    it("설명 문구·원본 기록에 키가 없다", async () => {
      const { provider } = build(200, ok("매직클린"));
      const result = await provider.recognize(IMAGE, "image/png");

      expect(provider.describe()).not.toContain(KEY);
      expect(JSON.stringify(result.raw)).not.toContain(KEY);
    });

    it("오류 문구에도 키가 실린 URL을 쓰지 않는다", async () => {
      const { provider } = build(403, { error: { message: "nope" } });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(KEY),
        }) as Error,
      );
    });

    it("네트워크 실패 문구에도 키가 없다", async () => {
      const provider = new GoogleVisionOcrProvider({
        apiKey: KEY,
        endpoint: "https://vision.example.test/v1/images:annotate",
        fetchFn: async () => {
          throw new Error("boom");
        },
      });
      await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(KEY),
        }) as Error,
      );
    });
  });

  it("재시도하지 않는다 — 재시도는 실행 계층의 책임이다", async () => {
    // 여기서 또 재시도하면 OcrExecutionService의 횟수와 곱해진다
    const { provider, calls } = build(500, { error: { message: "boom" } });
    await expect(provider.recognize(IMAGE, "image/png")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
