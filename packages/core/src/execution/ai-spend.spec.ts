import {
  AI_SPEND_SOURCES,
  combineAiSpend,
  describeAiSpend,
  evaluateBudgetWindow,
} from ".";

describe("AI 지출 합산 (TASK-3001, CTO 결정 2901-④)", () => {
  it("원장은 둘이고 지출은 하나다", () => {
    expect([...AI_SPEND_SOURCES]).toEqual(["llm", "ocr"]);
    expect(combineAiSpend({ llm: 1.5, ocr: 0.0045 })).toEqual({
      total: 1.5045,
      bySource: { llm: 1.5, ocr: 0.0045 },
    });
  });

  it("OCR만 있어도 예산에 들어간다", () => {
    // 이것이 편입의 핵심이다 — 그전에는 OCR 지출이 상한 밖에 있었다
    const spend = combineAiSpend({ llm: 0, ocr: 3 });
    expect(spend.total).toBe(3);
    expect(evaluateBudgetWindow(spend.total, 2).status).toBe("exceeded");
  });

  it("이상한 값은 0으로 본다 — 예산이 낮게 보이는 것이 더 위험하다", () => {
    expect(combineAiSpend({ llm: Number.NaN, ocr: -5 })).toEqual({
      total: 0,
      bySource: { llm: 0, ocr: 0 },
    });
  });

  it("합계 정밀도는 기록과 같다 (소수 6자리)", () => {
    expect(combineAiSpend({ llm: 0.0000004, ocr: 0.0000004 }).total).toBe(
      0.000001,
    );
  });

  describe("문구", () => {
    it("원장별로 밝힌다 — 총액만 말하면 왜 늘었는지 알 수 없다", () => {
      const text = describeAiSpend(combineAiSpend({ llm: 2, ocr: 0.15 }));
      expect(text).toContain("AI 지출 $2.150000");
      expect(text).toContain("LLM $2.000000");
      expect(text).toContain("OCR $0.150000");
    });

    it("마크다운 강조가 새지 않는다", () => {
      expect(
        describeAiSpend(combineAiSpend({ llm: 0, ocr: 0 })),
      ).not.toContain("**");
    });
  });
});
