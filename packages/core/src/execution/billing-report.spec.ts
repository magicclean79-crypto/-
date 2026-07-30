import {
  BILLING_DISCLAIMER,
  buildBillingReport,
  describeBillingReport,
} from "./billing-report";
import type { BillingGroupInput } from "./billing-report";

const FROM = new Date("2026-07-01T00:00:00.000Z");
const TO = new Date("2026-07-31T23:59:59.000Z");

const group = (
  overrides: Partial<BillingGroupInput> = {},
): BillingGroupInput => ({
  source: "llm",
  provider: "openai",
  model: "gpt-4o",
  calls: 10,
  cost: 0.1,
  unpricedCalls: 0,
  ...overrides,
});

describe("운영 비용 리포트 (TASK-3101, CTO 정책 3101-④)", () => {
  it("원장별로 합산하고 총액을 낸다", () => {
    const report = buildBillingReport({
      from: FROM,
      to: TO,
      groups: [
        group(),
        group({ source: "ocr", provider: "google-vision", model: "text-detection", cost: 0.03 }),
      ],
    });
    expect(report.total).toBe(0.13);
    expect(report.bySource).toEqual({ llm: 0.1, ocr: 0.03 });
    expect(report.calls).toBe(20);
  });

  it("비용 큰 것부터 정렬한다 — 리포트를 여는 이유가 그것이다", () => {
    const report = buildBillingReport({
      from: FROM,
      to: TO,
      groups: [
        group({ model: "small", cost: 0.01 }),
        group({ model: "big", cost: 1 }),
        group({ model: "middle", cost: 0.5 }),
      ],
    });
    expect(report.rows.map((row) => row.model)).toEqual([
      "big",
      "middle",
      "small",
    ]);
  });

  it("비중을 계산하되 총액이 0이면 말하지 않는다", () => {
    const paid = buildBillingReport({
      from: FROM,
      to: TO,
      groups: [group({ cost: 0.75 }), group({ model: "b", cost: 0.25 })],
    });
    expect(paid.rows[0].share).toBe(0.75);

    // 0%로 적으면 "안 썼다"로 읽힌다 — 나눌 수 없으면 null이다
    const free = buildBillingReport({
      from: FROM,
      to: TO,
      groups: [group({ cost: 0 })],
    });
    expect(free.rows[0].share).toBeNull();
  });

  it("미산정 호출이 있으면 총액이 실제보다 작다고 말한다", () => {
    const report = buildBillingReport({
      from: FROM,
      to: TO,
      groups: [group({ cost: null, unpricedCalls: 10 })],
    });
    expect(report.unpricedCalls).toBe(10);
    expect(report.total).toBe(0);
    expect(report.detail).toContain("합계는 실제보다 작습니다");
  });

  it("미산정이 없으면 그 문구를 붙이지 않는다", () => {
    const report = buildBillingReport({ from: FROM, to: TO, groups: [group()] });
    expect(report.detail).not.toContain("실제보다 작습니다");
  });

  describe("회계 청구서를 대체하지 않는다", () => {
    it("리포트에 항상 면책 문구가 담긴다", () => {
      const report = buildBillingReport({ from: FROM, to: TO, groups: [] });
      expect(report.disclaimer).toBe(BILLING_DISCLAIMER);
      expect(report.detail).toContain("회계 청구서를 대체하지 않습니다");
    });

    it("왜 다를 수 있는지도 함께 적는다", () => {
      // 이유가 없으면 "우리 숫자가 틀렸다"로 읽히고, 그러면 리포트를 신뢰하지 않는다
      expect(BILLING_DISCLAIMER).toContain("미산정");
      expect(BILLING_DISCLAIMER).toContain("무료 구간");
      expect(BILLING_DISCLAIMER).toContain("환율");
    });

    it("빈 기간에도 면책 문구는 남는다", () => {
      const report = buildBillingReport({ from: FROM, to: TO, groups: [] });
      expect(report.total).toBe(0);
      expect(report.rows).toEqual([]);
      expect(report.detail).toContain("회계 청구서를 대체하지 않습니다");
    });
  });

  it("기간을 ISO로 남긴다", () => {
    const report = buildBillingReport({ from: FROM, to: TO, groups: [] });
    expect(report.period.from).toBe(FROM.toISOString());
    expect(report.period.to).toBe(TO.toISOString());
  });

  it("마크다운 강조가 새지 않는다", () => {
    const text = describeBillingReport({
      total: 1,
      calls: 2,
      unpricedCalls: 3,
      bySource: { llm: 1, ocr: 0 },
    });
    expect(text).not.toContain("**");
  });
});
