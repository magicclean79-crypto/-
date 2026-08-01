import { DEFAULT_LLM_PRICING } from "./execution";
import {
  LLM_PRICE_PROVENANCE,
  PRICE_STALE_AFTER_DAYS,
  judgePriceFreshness,
  reportUnpricedModels,
} from "./pricing-provenance";

const NOW = Date.parse("2026-08-01T00:00:00Z");

describe("judgePriceFreshness (TASK-4701)", () => {
  /**
   * 표에 값이 있다는 것과 그 값이 맞다는 것은 다르다. 지금까지 화면의
   * "$0.0123"을 보고 아무도 그 단가가 언제 것인지 물을 수 없었다.
   */
  it("가격표 전 항목의 출처가 적혀 있다", () => {
    const report = judgePriceFreshness(DEFAULT_LLM_PRICING, NOW);
    expect(report.unknownSource).toBe(0);
    expect(report.rows).toHaveLength(Object.keys(DEFAULT_LLM_PRICING).length);
  });

  it("출처를 모르는 단가는 그 사실을 말한다", () => {
    const report = judgePriceFreshness(
      { "새-모델": { inputPerMillion: 1, outputPerMillion: 2 } },
      NOW,
      {},
    );
    expect(report.rows[0].freshness).toBe("unknown-source");
    expect(report.rows[0].ageDays).toBeNull();
    expect(report.rows[0].next).toContain("출처");
  });

  /**
   * 오래됐다는 것은 "바뀌었다"가 아니라 "확인한 지 오래됐다"다 — 그 둘을
   * 뭉치면 멀쩡한 단가에 사람을 부르게 되고, 사람은 곧 그 경고를 끈다.
   */
  it("오래된 단가를 틀렸다고 말하지 않는다", () => {
    const later = NOW + (PRICE_STALE_AFTER_DAYS + 10) * 86_400_000;
    const report = judgePriceFreshness(DEFAULT_LLM_PRICING, later);
    expect(report.stale).toBeGreaterThan(0);
    for (const row of report.rows) {
      expect(row.next ?? "").not.toContain("틀렸");
    }
  });

  it("상한 안쪽이면 fresh다", () => {
    const later = NOW + (PRICE_STALE_AFTER_DAYS - 1) * 86_400_000;
    const report = judgePriceFreshness(DEFAULT_LLM_PRICING, later);
    expect(report.stale).toBe(0);
    expect(report.fresh).toBe(report.rows.length);
  });

  /** 못 믿는 것을 문장 맨 앞에 — 뒤에 붙이면 앞부분만 읽힌다 */
  it("문제가 있으면 요약이 그것부터 말한다", () => {
    const report = judgePriceFreshness(
      { a: { inputPerMillion: 1, outputPerMillion: 1 } },
      NOW,
      {},
    );
    expect(report.summary.startsWith("출처를 모르는 단가")).toBe(true);
  });

  it("가격표에 있는 모델과 출처표의 모델이 어긋나지 않는다", () => {
    for (const model of Object.keys(LLM_PRICE_PROVENANCE)) {
      expect(Object.keys(DEFAULT_LLM_PRICING)).toContain(model);
    }
  });
});

describe("reportUnpricedModels (TASK-4701)", () => {
  const call = (model: string, feature: string, createdAt: string) => ({
    model,
    provider: "openai",
    feature,
    createdAt,
  });

  it("없으면 없다고 말한다", () => {
    expect(reportUnpricedModels([]).rows).toHaveLength(0);
    expect(reportUnpricedModels([]).summary).toContain("없습니다");
  });

  /**
   * 건수는 사람이 할 수 있는 일을 알려 주지 않는다 — 무엇을 등록해야 하는지,
   * 어디서 부르고 있는지가 없기 때문이다.
   */
  it("이름·기능·처음 본 날까지 낸다", () => {
    const report = reportUnpricedModels([
      call("새-모델", "content-generation", "2026-07-01T00:00:00Z"),
      call("새-모델", "product-analysis", "2026-07-05T00:00:00Z"),
    ]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].model).toBe("새-모델");
    expect(report.rows[0].calls).toBe(2);
    expect(report.rows[0].features).toEqual(["content-generation", "product-analysis"]);
    expect(report.rows[0].firstSeen).toBe("2026-07-01T00:00:00Z");
    expect(report.rows[0].lastSeen).toBe("2026-07-05T00:00:00Z");
  });

  it("많이 불린 것부터 보여준다", () => {
    const report = reportUnpricedModels([
      call("드문-모델", "dev", "2026-07-01T00:00:00Z"),
      call("잦은-모델", "dev", "2026-07-01T00:00:00Z"),
      call("잦은-모델", "dev", "2026-07-02T00:00:00Z"),
    ]);
    expect(report.rows[0].model).toBe("잦은-모델");
  });

  /** 지어낸 단가로 채우면 경보는 사라지지만 그 비용은 만들어낸 것이 된다 */
  it("단가를 추정하지 않는다", () => {
    const report = reportUnpricedModels([call("새-모델", "dev", "2026-07-01T00:00:00Z")]);
    expect(JSON.stringify(report)).not.toContain("perMillion");
    expect(report.rows[0].next).toContain("등록해");
  });

  /** 합계가 최소값이라는 사실을 감추지 않는다 */
  it("지출 합계가 최소값이라고 말한다", () => {
    const report = reportUnpricedModels([call("새-모델", "dev", "2026-07-01T00:00:00Z")]);
    expect(report.summary).toContain("최소값");
  });
});
