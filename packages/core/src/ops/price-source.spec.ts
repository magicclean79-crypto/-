import { DEFAULT_LLM_PRICING } from "../execution/execution";
import { DEFAULT_OCR_PRICING } from "../ocr/ocr-pricing";
import {
  comparePublishedPrices,
  judgePriceSource,
  PRICE_SOURCE_FORMATS,
  PRICE_SOURCE_PARSERS,
  resolvePriceSources,
  summarizePriceSources,
} from "./price-source";

const URL = "https://provider.example/pricing.json";

const feed = (entries: unknown[]) => ({ url: URL, body: entries, error: null });

describe("외부 가격 공지 (TASK-3301, CTO 정책 3301-①)", () => {
  describe("실패를 '변경 없음'으로 처리하지 않는다", () => {
    it("닿지 못하면 사람 확인을 요구한다", () => {
      const verdict = judgePriceSource({
        url: URL,
        body: null,
        error: "timeout after 5000ms",
      });
      expect(verdict.status).toBe("unreachable");
      expect(verdict.needsHumanCheck).toBe(true);
      expect(verdict.prices).toEqual([]);
      // 못 읽은 것과 바뀐 것이 없는 것은 다르다
      expect(verdict.detail).toContain("단가가 그대로라는 뜻이 아닙니다");
    });

    it("해석할 수 없으면 형식 변화를 의심하라고 말한다", () => {
      const verdict = judgePriceSource({
        url: URL,
        body: "<html>Pricing</html>",
        error: null,
      });
      expect(verdict.status).toBe("unparsable");
      expect(verdict.needsHumanCheck).toBe(true);
      expect(verdict.detail).toContain("형식이 바뀌었는지");
    });

    it("모든 항목을 해석하지 못해도 조용히 지나가지 않는다", () => {
      const verdict = judgePriceSource(feed([{ target: "x" }, 42]));
      expect(verdict.status).toBe("unparsable");
      expect(verdict.unparsed).toHaveLength(2);
      expect(verdict.needsHumanCheck).toBe(true);
    });

    it("일부만 읽었으면 읽은 것은 쓰고 못 읽은 것은 말한다", () => {
      // 아홉을 읽었다고 "성공"이라 하면 못 읽은 하나가 조용히 사라진다
      const verdict = judgePriceSource(
        feed([
          { target: "ocr", key: "google-vision", perUnitUsd: 0.002 },
          { target: "ocr", key: "clova" }, // 단가 없음
        ]),
      );
      expect(verdict.status).toBe("partial");
      expect(verdict.prices).toHaveLength(1);
      expect(verdict.unparsed).toHaveLength(1);
      expect(verdict.unparsed[0].index).toBe(1);
      expect(verdict.needsHumanCheck).toBe(true);
      expect(verdict.detail).toContain("직접 확인해 주세요");
    });

    it("미구성은 실패가 아니지만 확인은 필요하다", () => {
      const verdict = judgePriceSource({ url: null, body: null, error: null });
      expect(verdict.status).toBe("unconfigured");
      expect(verdict.needsHumanCheck).toBe(true);
      expect(verdict.detail).toContain("미구성이며 실패가 아닙니다");
    });

    it("전부 읽었을 때만 확인이 필요 없다", () => {
      const verdict = judgePriceSource(
        feed([{ target: "ocr", key: "google-vision", perUnitUsd: 0.002 }]),
      );
      expect(verdict.status).toBe("ok");
      expect(verdict.needsHumanCheck).toBe(false);
    });
  });

  describe("해석", () => {
    it("배열과 prices 필드를 모두 받는다", () => {
      const entry = { target: "ocr", key: "google-vision", perUnitUsd: 0.002 };
      expect(judgePriceSource(feed([entry])).prices).toHaveLength(1);
      expect(
        judgePriceSource({ url: URL, body: { prices: [entry] }, error: null })
          .prices,
      ).toHaveLength(1);
    });

    it("LLM은 입력·출력 단가를 둘 다 요구한다", () => {
      const verdict = judgePriceSource(
        feed([{ target: "llm", key: "gpt-4o", inputPerMillion: 3 }]),
      );
      expect(verdict.status).toBe("unparsable");
      expect(verdict.unparsed[0].reason).toContain("outputPerMillion");
    });

    it("음수 단가는 해석하지 않는다 — 예산 상한을 무력화한다", () => {
      expect(
        judgePriceSource(feed([{ target: "ocr", key: "x", perUnitUsd: -1 }]))
          .status,
      ).toBe("unparsable");
    });

    it("발효 시각이 있으면 읽고, 이상하면 null로 둔다", () => {
      // 잘못 읽은 시각으로 예약하면 엉뚱한 날 단가가 바뀐다
      const good = judgePriceSource(
        feed([
          {
            target: "ocr",
            key: "google-vision",
            perUnitUsd: 0.002,
            effectiveFrom: "2026-09-01T00:00:00Z",
          },
        ]),
      );
      expect(good.prices[0].effectiveFrom).toBe("2026-09-01T00:00:00.000Z");

      const bad = judgePriceSource(
        feed([
          {
            target: "ocr",
            key: "google-vision",
            perUnitUsd: 0.002,
            effectiveFrom: "다음 달",
          },
        ]),
      );
      expect(bad.prices[0].effectiveFrom).toBeNull();
      // 시각을 못 읽은 것으로 항목 전체를 버리지는 않는다
      expect(bad.status).toBe("ok");
    });
  });

  describe("우리 가격표와 대조", () => {
    const effective = { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING };

    it("다르면 차이를 돌려준다", () => {
      const changes = comparePublishedPrices({
        published: [
          {
            target: "ocr",
            key: "google-vision",
            price: { perUnitUsd: 0.002 },
            effectiveFrom: "2026-09-01T00:00:00.000Z",
          },
        ],
        effective,
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].current).toEqual({ perUnitUsd: 0.0015 });
      expect(changes[0].effectiveFrom).toBe("2026-09-01T00:00:00.000Z");
      expect(changes[0].reason).toContain("가격 공지가");
    });

    it("같으면 조용하다", () => {
      expect(
        comparePublishedPrices({
          published: [
            {
              target: "ocr",
              key: "google-vision",
              price: { perUnitUsd: 0.0015 },
              effectiveFrom: null,
            },
          ],
          effective,
        }),
      ).toEqual([]);
    });

    it("가격표에 없던 항목도 알린다", () => {
      const changes = comparePublishedPrices({
        published: [
          {
            target: "ocr",
            key: "clova",
            price: { perUnitUsd: 0.001 },
            effectiveFrom: null,
          },
        ],
        effective,
      });
      expect(changes[0].current).toBeNull();
      expect(changes[0].reason).toContain("우리 가격표에 없던 항목");
    });

    it("공지에 발효 시각이 없으면 사람이 정한다고 말한다", () => {
      const changes = comparePublishedPrices({
        published: [
          {
            target: "llm",
            key: "gpt-4o",
            price: { inputPerMillion: 3, outputPerMillion: 12 },
            effectiveFrom: null,
          },
        ],
        effective,
      });
      expect(changes[0].reason).toContain("적용 시각은 사람이 정합니다");
    });

    it("LLM은 두 단가 중 하나만 달라도 차이다", () => {
      expect(
        comparePublishedPrices({
          published: [
            {
              target: "llm",
              key: "gpt-4o",
              price: { inputPerMillion: 2.5, outputPerMillion: 11 },
              effectiveFrom: null,
            },
          ],
          effective,
        }),
      ).toHaveLength(1);
    });

    it("마크다운 강조가 새지 않는다", () => {
      const changes = comparePublishedPrices({
        published: [
          {
            target: "ocr",
            key: "google-vision",
            price: { perUnitUsd: 0.002 },
            effectiveFrom: null,
          },
        ],
        effective,
      });
      expect(changes[0].reason).not.toContain("**");
    });
  });
});

/**
 * Provider별 공지 (TASK-3401 — CTO 결정 3301-⑤).
 *
 * 한 주소가 모든 단가를 담으면 그 주소 하나가 죽을 때 **아무 단가도 대조하지
 * 못한다.** 소스를 나누면 하나가 죽어도 나머지는 읽히고, 실패한 것은 실패로
 * 남는다.
 */
describe("Provider별 공지 (TASK-3401, CTO 결정 3301-⑤)", () => {
  describe("설정 해석", () => {
    it("기존 PRICE_SOURCE_URL은 기본 소스로 그대로 돈다", () => {
      const { sources } = resolvePriceSources({ PRICE_SOURCE_URL: URL });
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe("default");
      expect(sources[0].format).toBe("acos");
    });

    it("책임지는 단가 키를 선언할 수 있다 (TASK-3501)", () => {
      const { sources } = resolvePriceSources({
        PRICE_SOURCE_URL_OPENAI: "https://openai.example/p.json",
        PRICE_SOURCE_KEYS_OPENAI: "gpt-4o, gpt-4o-mini ,",
      });
      expect(sources[0].keys).toEqual(["gpt-4o", "gpt-4o-mini"]);
    });

    it("선언하지 않으면 빈 배열이다 — 모르는 것을 아는 척하지 않는다", () => {
      const { sources } = resolvePriceSources({ PRICE_SOURCE_URL: URL });
      expect(sources[0].keys).toEqual([]);
    });

    it("Provider별 주소를 각각 소스로 만든다", () => {
      const { sources } = resolvePriceSources({
        PRICE_SOURCE_URL_OPENAI: "https://openai.example/p.json",
        PRICE_SOURCE_URL_GOOGLE_VISION: "https://g.example/p.json",
      });
      expect(sources.map((row) => row.id)).toEqual(["google-vision", "openai"]);
    });

    it("Provider별 형식을 따로 둘 수 있다", () => {
      const { sources } = resolvePriceSources({
        PRICE_SOURCE_URL_OPENAI: "https://openai.example/p.json",
        PRICE_SOURCE_FORMAT_OPENAI: "flat",
      });
      expect(sources[0].format).toBe("flat");
    });

    it("모르는 형식은 짐작해서 읽지 않고 거부한다", () => {
      const { sources, rejected } = resolvePriceSources({
        PRICE_SOURCE_URL_OPENAI: "https://openai.example/p.json",
        PRICE_SOURCE_FORMAT_OPENAI: "yaml",
      });
      expect(sources).toHaveLength(0);
      expect(rejected[0].reason).toContain("잘못 읽은 단가는");
    });

    it("이름은 아는데 아직 못 만든 형식은 다르게 말한다 (TASK-3601, 정책 3601-③)", () => {
      // 오타를 의심할 일과 어댑터를 요청할 일은 다르다
      for (const format of ["html", "rss", "jsonfeed"]) {
        const { sources, rejected } = resolvePriceSources({
          PRICE_SOURCE_URL_OPENAI: "https://openai.example/p",
          PRICE_SOURCE_FORMAT_OPENAI: format,
        });
        expect(sources).toHaveLength(0);
        expect(rejected[0].reason).toContain("아직 어댑터가 없습니다");
        expect(rejected[0].reason).toContain("파서 하나만 더하면");
      }
    });

    it("모르는 형식은 예정된 형식까지 함께 알려 준다", () => {
      const { rejected } = resolvePriceSources({
        PRICE_SOURCE_URL_OPENAI: "https://openai.example/p",
        PRICE_SOURCE_FORMAT_OPENAI: "yaml",
      });
      expect(rejected[0].reason).toContain("알 수 없는 공지 형식");
      expect(rejected[0].reason).toContain("html·rss·jsonfeed");
    });

    it("형식이 늘어도 판정은 한 곳에서만 한다 (정책 3601-③)", () => {
      // 파서는 "줄의 목록으로 펴는 것"만 한다 — 유효성 판정은 늘지 않는다
      expect(Object.keys(PRICE_SOURCE_PARSERS).sort()).toEqual(
        [...PRICE_SOURCE_FORMATS].sort(),
      );
    });

    it("프로젝트별 공지는 거부하고 사유를 남긴다", () => {
      const { sources, rejected } = resolvePriceSources({
        PRICE_SOURCE_URL_PROJECT_ACME: "https://acme.example/p.json",
      });
      expect(sources).toHaveLength(0);
      expect(rejected[0].name).toBe("PRICE_SOURCE_URL_PROJECT_ACME");
      expect(rejected[0].reason).toContain("Provider와의 계약");
    });

    it("토큰은 Provider별 값이 있으면 그것을 쓴다 — 값은 담지 않는다", () => {
      const { sources } = resolvePriceSources({
        PRICE_SOURCE_URL_OPENAI: "https://openai.example/p.json",
        PRICE_SOURCE_TOKEN_OPENAI: "secret",
      });
      expect(sources[0].tokenEnv).toBe("PRICE_SOURCE_TOKEN_OPENAI");
      expect(JSON.stringify(sources)).not.toContain("secret");
    });
  });

  describe("flat 형식 어댑터", () => {
    it("사전형 공지를 우리 계약과 같은 결과로 읽는다", () => {
      const verdict = judgePriceSource({
        url: URL,
        format: "flat",
        body: {
          models: { "gpt-4o": { input: 2.5, output: 10 } },
          engines: { "google-vision": { perUnit: 0.0015 } },
        },
        error: null,
      });
      expect(verdict.status).toBe("ok");
      expect(verdict.prices).toHaveLength(2);
    });

    it("형식이 다르면 해석할 수 없다고 말한다 — 빈 목록으로 바꾸지 않는다", () => {
      const verdict = judgePriceSource({
        url: URL,
        format: "flat",
        body: [{ target: "ocr", key: "google-vision", perUnitUsd: 0.001 }],
        error: null,
      });
      expect(verdict.status).toBe("unparsable");
      expect(verdict.detail).toContain("models·engines");
    });

    it("값이 빠진 항목은 flat에서도 못 읽은 것으로 남는다", () => {
      const verdict = judgePriceSource({
        url: URL,
        format: "flat",
        body: { engines: { clova: {}, "google-vision": { perUnit: 0.0015 } } },
        error: null,
      });
      expect(verdict.status).toBe("partial");
      expect(verdict.unparsed[0].reason).toContain("clova");
    });
  });

  describe("csv 형식 어댑터 (TASK-3501)", () => {
    const csv = [
      "target,key,inputPerMillion,outputPerMillion,perUnitUsd,effectiveFrom",
      "llm,gpt-4o,2.5,10,,2026-09-01T00:00:00.000Z",
      "ocr,google-vision,,,0.0015,",
    ].join("\n");

    it("표로 공개된 공지도 같은 결과로 읽는다", () => {
      const verdict = judgePriceSource({
        url: URL,
        format: "csv",
        body: csv,
        error: null,
      });
      expect(verdict.status).toBe("ok");
      expect(verdict.prices).toHaveLength(2);
      expect(verdict.prices[0].effectiveFrom).toBe("2026-09-01T00:00:00.000Z");
    });

    it("빈 칸을 0으로 읽지 않는다 — 0은 무료라는 뜻이 된다", () => {
      const verdict = judgePriceSource({
        url: URL,
        format: "csv",
        body: ["target,key,perUnitUsd", "ocr,clova,"].join("\n"),
        error: null,
      });
      expect(verdict.status).toBe("unparsable");
      expect(verdict.unparsed[0].reason).toContain("clova");
    });

    it("머리글이 없으면 해석할 수 없다고 말한다", () => {
      const verdict = judgePriceSource({
        url: URL,
        format: "csv",
        body: "이번 달 가격 안내\n감사합니다",
        error: null,
      });
      expect(verdict.status).toBe("unparsable");
      expect(verdict.detail).toContain("target·key 머리글");
    });
  });

  describe("여러 소스 합치기", () => {
    const okVerdict = judgePriceSource(
      feed([{ target: "ocr", key: "google-vision", perUnitUsd: 0.002 }]),
    );
    const deadVerdict = judgePriceSource({
      url: "https://dead.example/p.json",
      body: null,
      error: "HTTP 503",
    });

    it("하나도 없으면 미구성이다 — 실패가 아니다", () => {
      const summary = summarizePriceSources([]);
      expect(summary.status).toBe("unconfigured");
      expect(summary.detail).toContain("실패가 아닙니다");
    });

    it("한 곳이 죽어도 나머지에서 읽은 단가는 그대로 쓴다", () => {
      const summary = summarizePriceSources([
        { id: "google", url: URL, format: "acos", verdict: okVerdict },
        { id: "openai", url: "x", format: "acos", verdict: deadVerdict },
      ]);
      expect(summary.prices).toHaveLength(1);
      expect(summary.read).toBe(1);
      expect(summary.total).toBe(2);
    });

    it("전체 상태는 가장 나쁜 것을 따른다 — 둘을 읽었다고 정상이라 하지 않는다", () => {
      const summary = summarizePriceSources([
        { id: "google", url: URL, format: "acos", verdict: okVerdict },
        { id: "openai", url: "x", format: "acos", verdict: deadVerdict },
      ]);
      expect(summary.status).toBe("unreachable");
      expect(summary.needsHumanCheck).toBe(true);
      expect(summary.failed).toEqual(["openai"]);
      expect(summary.detail).toContain("openai(unreachable)");
    });

    it("죽은 소스가 책임지던 단가를 이름으로 말한다 (TASK-3501)", () => {
      const summary = summarizePriceSources([
        {
          id: "openai",
          url: "x",
          format: "acos",
          keys: ["gpt-4o", "gpt-4o-mini"],
          verdict: deadVerdict,
        },
        {
          id: "google",
          url: URL,
          format: "acos",
          keys: ["google-vision"],
          verdict: okVerdict,
        },
      ]);
      expect(summary.unverifiedKeys).toEqual(["gpt-4o", "gpt-4o-mini"]);
      expect(summary.detail).toContain("확인하지 못한 단가: gpt-4o, gpt-4o-mini");
    });

    it("책임 키를 선언하지 않았으면 무엇을 못 봤는지도 말하지 않는다", () => {
      const summary = summarizePriceSources([
        { id: "openai", url: "x", format: "acos", verdict: deadVerdict },
      ]);
      expect(summary.unverifiedKeys).toEqual([]);
      expect(summary.detail).not.toContain("확인하지 못한 단가");
    });

    it("어느 공지에서 온 단가인지 잃지 않는다", () => {
      const summary = summarizePriceSources([
        { id: "google", url: URL, format: "acos", verdict: okVerdict },
      ]);
      expect(summary.prices[0].sourceId).toBe("google");

      const changes = comparePublishedPrices({
        published: summary.prices,
        effective: { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING },
      });
      expect(changes[0].sourceId).toBe("google");
    });
  });
});
