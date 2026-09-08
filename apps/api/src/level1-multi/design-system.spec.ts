import { getDesignTokens, selectDesignTemplate } from "./design-system";

describe("selectDesignTemplate", () => {
  it("스테인리스/금속 소재가 있으면 commercial-editorial을 선택한다", () => {
    const result = selectDesignTemplate({ category: null, materials: ["Plastic", "Stainless", "Rubber"] });
    expect(result.templateId).toBe("commercial-editorial");
    expect(result.reason).toContain("금속/스테인리스");
    expect(result.tokens).toEqual(getDesignTokens("commercial-editorial"));
  });

  it("카테고리가 생활/하드웨어 성격이면 소재 정보가 없어도 commercial-editorial을 선택한다", () => {
    const result = selectDesignTemplate({ category: "생활용품", materials: [] });
    expect(result.templateId).toBe("commercial-editorial");
    expect(result.reason).toContain("생활/하드웨어");
  });

  it("카테고리·소재 정보가 전혀 없으면 minimal-product를 선택한다", () => {
    const result = selectDesignTemplate({ category: null, materials: [] });
    expect(result.templateId).toBe("minimal-product");
  });

  it("산업 신호는 없지만 소재/카테고리 정보가 있으면 technical-commerce를 선택한다", () => {
    const result = selectDesignTemplate({ category: "뷰티", materials: ["Cotton"] });
    expect(result.templateId).toBe("technical-commerce");
  });

  it("각 템플릿의 design token은 필수 필드를 모두 채운다", () => {
    for (const id of ["commercial-editorial", "technical-commerce", "minimal-product"] as const) {
      const tokens = getDesignTokens(id);
      expect(tokens.templateId).toBe(id);
      expect(tokens.background).toMatch(/^#/);
      expect(tokens.accent).toMatch(/^#/);
      expect(tokens.maxWidth).toBeTruthy();
      expect(tokens.sectionSpacing.mobile).toBeTruthy();
      expect(tokens.sectionSpacing.desktop).toBeTruthy();
      expect(tokens.grid.benefitColumns).toBeGreaterThan(0);
    }
  });
});
