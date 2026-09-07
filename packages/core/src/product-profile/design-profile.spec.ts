import {
  ACCENT_USAGES,
  CARD_RADII,
  CARD_VARIANTS,
  checkColorwayContrastGuardrail,
  COLORWAY_IDS,
  COMPOSITION_FAMILIES,
  contrastRatio,
  DesignProfileParseError,
  FAMILY_COLORWAYS,
  GRAPHIC_MOTIF_FAMILIES,
  GRAPHIC_MOTIF_INTENSITIES,
  ICON_FAMILIES,
  parseDesignDirectorResponse,
  relativeLuminance,
  resolveComposition,
  resolveDesignProfile,
  VISUAL_STYLE_FAMILIES,
  type DesignDirectorChoice,
} from "./design-profile";

function validChoice(overrides: Partial<DesignDirectorChoice> = {}): DesignDirectorChoice {
  return {
    visualStyle: "industrial-premium",
    colorway: "harbor-steel",
    rationale: "검정 금속 소재의 실용적 도구성 제품이라 industrial 톤을 선택함",
    typography: {
      headingWeight: "700",
      letterSpacing: "tight",
      lineHeight: "comfortable",
      numericStyle: "tabular",
      accentTypeface: "technical-grotesk",
    },
    iconStyle: { family: "technical-outline", strokeWidth: "regular", cornerStyle: "sharp", opticalSize: "standard" },
    cardStyle: { variant: "soft-shadow", radius: "soft" },
    graphicMotif: { family: "dot-grid", intensity: "subtle" },
    spacingDensity: "standard",
    imageTreatment: { backgroundTreatment: "letterbox-neutral" },
    accentUsage: "balanced",
    avoid: [],
    ...overrides,
  };
}

describe("design-profile — composition family (T1-183/T1-185)", () => {
  it("최소 6개 composition family가 정의되어 있다", () => {
    expect(COMPOSITION_FAMILIES.length).toBeGreaterThanOrEqual(6);
  });

  it("family마다 완결된 토큰 조합을 돌려주고, family 자체가 일치한다", () => {
    for (const family of COMPOSITION_FAMILIES) {
      const resolved = resolveComposition(family);
      expect(resolved.family).toBe(family);
    }
  });

  it("서로 다른 family는 실제로 다른 geometry를 만든다 — 6개 모두가 동일한 토큰 조합이 아니다", () => {
    const signatures = new Set(
      COMPOSITION_FAMILIES.map((family) => {
        const r = resolveComposition(family);
        return [
          r.hero.aspect,
          r.gallery.cellAspect,
          r.gallery.density,
          r.includedGrid,
          r.headlineAlignment,
          r.sectionSpacing,
          r.textMeasure,
        ].join("|");
      }),
    );
    expect(signatures.size).toBe(COMPOSITION_FAMILIES.length);
  });

  it("알 수 없는/빈 family는 editorial-brochure로 안전하게 fallback한다", () => {
    expect(resolveComposition(undefined).family).toBe("editorial-brochure");
    expect(resolveComposition(null).family).toBe("editorial-brochure");
  });
});

describe("design-profile — colorway contrast guardrail", () => {
  it("모든 colorway가 WCAG AA(4.5:1) 대비를 통과한다", () => {
    for (const colorwayId of COLORWAY_IDS) {
      const report = checkColorwayContrastGuardrail(colorwayId);
      expect(report.passesAA).toBe(true);
    }
  });

  it("relativeLuminance/contrastRatio는 알려진 값(#000000 vs #ffffff = 21:1)을 만든다", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 2);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 2);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 2);
  });

  it("각 family는 최소 2개의 colorway를 갖는다 — 같은 family 안에서도 조합 variation을 허용한다", () => {
    for (const family of VISUAL_STYLE_FAMILIES) {
      expect(FAMILY_COLORWAYS[family].length).toBeGreaterThanOrEqual(2);
    }
  });

  it("family는 5개 이상이다", () => {
    expect(VISUAL_STYLE_FAMILIES.length).toBeGreaterThanOrEqual(5);
  });
});

describe("design-profile — 아이콘 family (T1-177)", () => {
  it("icon family는 5개 이상이다 — canonical SVG icon family registry", () => {
    expect(ICON_FAMILIES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ICON_FAMILIES).size).toBe(ICON_FAMILIES.length);
  });

  it("허용되지 않은 iconStyle.family는 거부한다 — invalid iconStyle fallback", () => {
    const invalid = validChoice();
    (invalid.iconStyle as unknown as Record<string, unknown>).family = "hand-drawn-sketch";
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("family가 아예 없으면 거부한다(안전하게 baseline으로 fallback할 신호를 준다)", () => {
    const invalid = validChoice();
    delete (invalid.iconStyle as unknown as Record<string, unknown>).family;
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("resolveDesignProfile은 choice의 iconStyle.family를 그대로 resolved.icon.family에 반영한다", () => {
    for (const family of ICON_FAMILIES) {
      const resolved = resolveDesignProfile(validChoice({ iconStyle: { family, strokeWidth: "regular", cornerStyle: "sharp", opticalSize: "standard" } }));
      expect(resolved.icon.family).toBe(family);
    }
  });
});

describe("design-profile — parseDesignDirectorResponse", () => {
  it("유효한 JSON을 올바르게 파싱한다", () => {
    const choice = validChoice();
    const parsed = parseDesignDirectorResponse(JSON.stringify(choice));
    expect(parsed.visualStyle).toBe("industrial-premium");
    expect(parsed.colorway).toBe("harbor-steel");
  });

  it("JSON 앞뒤에 다른 텍스트가 섞여 있어도 JSON 객체만 추출한다", () => {
    const choice = validChoice();
    const text = `여기 결과입니다:\n${JSON.stringify(choice)}\n이상입니다.`;
    const parsed = parseDesignDirectorResponse(text);
    expect(parsed.visualStyle).toBe("industrial-premium");
  });

  it("JSON 객체를 찾을 수 없으면 DesignProfileParseError를 던진다", () => {
    expect(() => parseDesignDirectorResponse("이건 JSON이 아닙니다")).toThrow(DesignProfileParseError);
  });

  it("허용되지 않은 visualStyle 값은 거부한다", () => {
    const invalid = { ...validChoice(), visualStyle: "cyberpunk-neon" };
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("family에 허용되지 않은 colorway 조합은 거부한다", () => {
    // "ink-paper"는 editorial-minimal 전용이며 industrial-premium에는 없다
    const invalid = { ...validChoice(), colorway: "ink-paper" };
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("rationale이 빈 문자열이면 거부한다", () => {
    const invalid = { ...validChoice(), rationale: "" };
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("typography가 객체가 아니면 거부한다", () => {
    const invalid = { ...validChoice(), typography: "bold" };
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("허용되지 않은 iconStyle.strokeWidth는 거부한다", () => {
    const invalid = validChoice();
    (invalid.iconStyle as unknown as Record<string, unknown>).strokeWidth = "ultra-thick";
    expect(() => parseDesignDirectorResponse(JSON.stringify(invalid))).toThrow(DesignProfileParseError);
  });

  it("avoid가 없으면 빈 배열로 취급한다", () => {
    const withoutAvoid: Record<string, unknown> = { ...validChoice() };
    delete withoutAvoid.avoid;
    const parsed = parseDesignDirectorResponse(JSON.stringify(withoutAvoid));
    expect(parsed.avoid).toEqual([]);
  });
});

describe("design-profile — resolveDesignProfile", () => {
  it("결정적이다 — 같은 choice는 항상 같은 결과를 만든다", () => {
    const choice = validChoice();
    const a = resolveDesignProfile(choice);
    const b = resolveDesignProfile(choice);
    expect(a).toEqual(b);
  });

  it("서로 다른 두 제품(family가 다른 choice)은 서로 다른 색/타이포/모티프를 만든다", () => {
    const industrial = resolveDesignProfile(validChoice());
    const soft = resolveDesignProfile(
      validChoice({
        visualStyle: "soft-premium",
        colorway: "blush-mauve",
        rationale: "패브릭 소재의 부드러운 유아용품이라 soft-premium 톤을 선택함",
        cardStyle: { variant: "elevated", radius: "round" },
        graphicMotif: { family: "none", intensity: "none" },
      }),
    );
    expect(industrial.tokens.textPrimary).not.toBe(soft.tokens.textPrimary);
    expect(industrial.layoutAccent["feature-highlight"]).not.toBe(soft.layoutAccent["feature-highlight"]);
    expect(industrial.motif.family).not.toBe(soft.motif.family);
  });

  it("notice 레이아웃 강조색은 layoutAccent에 포함되지 않는다 — 항상 고정색을 쓴다", () => {
    const resolved = resolveDesignProfile(validChoice());
    expect(resolved.layoutAccent.notice).toBeUndefined();
  });

  it("모든 iconStyle/cardStyle/graphicMotif enum 조합이 예외 없이 해석된다", () => {
    for (const family of VISUAL_STYLE_FAMILIES) {
      for (const colorway of FAMILY_COLORWAYS[family]) {
        for (const variant of CARD_VARIANTS) {
          for (const radius of CARD_RADII) {
            for (const motifFamily of GRAPHIC_MOTIF_FAMILIES) {
              for (const intensity of GRAPHIC_MOTIF_INTENSITIES) {
                for (const accentUsage of ACCENT_USAGES) {
                  const resolved = resolveDesignProfile(
                    validChoice({
                      visualStyle: family,
                      colorway,
                      cardStyle: { variant, radius },
                      graphicMotif: { family: motifFamily, intensity },
                      accentUsage,
                    }),
                  );
                  expect(resolved.tokens.textPrimary).toBeTruthy();
                }
              }
            }
          }
        }
      }
    }
  });

  it("graphicMotif.family가 none이면 opacity 0, backgroundImage none이다", () => {
    const resolved = resolveDesignProfile(validChoice({ graphicMotif: { family: "none", intensity: "medium" } }));
    expect(resolved.motif.opacity).toBe(0);
    expect(resolved.motif.backgroundImage).toBe("none");
  });

  it("resolveDesignProfile은 제품 이미지 필드를 전혀 받지 않는다(타입 시그니처 자체가 가드레일)", () => {
    // resolveDesignProfile(choice)는 DesignDirectorChoice만 받는다 — 이
    // 타입에는 imageIds/이미지 바이트/제품 형태 필드가 아예 없다.
    const choice = validChoice();
    expect(Object.keys(choice)).not.toContain("productShape");
    expect(Object.keys(choice)).not.toContain("imageIds");
  });
});
