import { DEFAULT_LLM_PRICING } from "../execution/execution";
import { DEFAULT_OCR_PRICING } from "../ocr/ocr-pricing";
import { comparePublishedPrices, judgePriceSource } from "./price-source";

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
