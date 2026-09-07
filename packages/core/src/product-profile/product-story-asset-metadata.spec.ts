import {
  validateSectionCompositionAssetMetadata,
  type SectionCompositionAssetMetadata,
} from "./product-story-asset-metadata";

function baseMetadata(overrides: Partial<SectionCompositionAssetMetadata> = {}): SectionCompositionAssetMetadata {
  return {
    productId: "profile-1",
    category: "HERO",
    purpose: "상세페이지 대표 이미지",
    referenceIds: ["img-1", "img-2"],
    version: 1,
    artDirectionContractId: "art-direction:hero:v1",
    provider: "openai",
    model: "gpt-image-2",
    ...overrides,
  };
}

const context = {
  expectedProductId: "profile-1",
  expectedCategory: "HERO" as const,
  expectedArtDirectionContractId: "art-direction:hero:v1",
};

describe("validateSectionCompositionAssetMetadata", () => {
  it("accepts a correctly-scoped asset", () => {
    const result = validateSectionCompositionAssetMetadata(baseMetadata(), context);
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects an asset that belongs to a different product", () => {
    const result = validateSectionCompositionAssetMetadata(baseMetadata({ productId: "profile-2" }), context);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("productId");
  });

  it("rejects an asset generated for a different section/category — prevents cross-section reuse", () => {
    const result = validateSectionCompositionAssetMetadata(baseMetadata({ category: "DETAIL" }), context);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("category");
  });

  it("rejects an asset built from a different Art Direction Contract", () => {
    const result = validateSectionCompositionAssetMetadata(
      baseMetadata({ artDirectionContractId: "art-direction:detail:v1" }),
      context,
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("artDirectionContractId");
  });

  it("rejects a COMPONENTS asset with no reference evidence when evidence is required", () => {
    const result = validateSectionCompositionAssetMetadata(
      baseMetadata({ category: "COMPONENTS", referenceIds: [], artDirectionContractId: "art-direction:components:v1" }),
      {
        expectedProductId: "profile-1",
        expectedCategory: "COMPONENTS",
        expectedArtDirectionContractId: "art-direction:components:v1",
        requireReferenceEvidence: true,
      },
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("참조 근거");
  });

  it("rejects an asset with an empty purpose", () => {
    const result = validateSectionCompositionAssetMetadata(baseMetadata({ purpose: "  " }), context);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("purpose");
  });

  it("rejects an asset with no provider/model recorded (T1-150)", () => {
    const result = validateSectionCompositionAssetMetadata(baseMetadata({ provider: "", model: "" }), context);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("provider/model");
  });

  it("collects multiple reasons at once", () => {
    const result = validateSectionCompositionAssetMetadata(
      baseMetadata({ productId: "other", category: "DETAIL" }),
      context,
    );
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
