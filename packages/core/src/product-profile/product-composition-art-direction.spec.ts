import { buildCompositionContract, buildCompositionPrompt } from "./product-composition-art-direction";

describe("buildCompositionContract", () => {
  it("is deterministic — same category+options produces the same contractId and content", () => {
    const a = buildCompositionContract("HERO");
    const b = buildCompositionContract("HERO");
    expect(a).toEqual(b);
    expect(a.contractId).toBe("art-direction:hero:v1");
  });

  it("produces a distinct contractId per category", () => {
    const ids = (
      ["HERO", "USAGE_SCENE", "DETAIL", "FEATURE_HIGHLIGHT", "COMPONENTS", "OTHER"] as const
    ).map((category) => buildCompositionContract(category).contractId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("threads storySectionPurpose into the contract purpose", () => {
    const contract = buildCompositionContract("USAGE_SCENE", { storySectionPurpose: "베란다 청소 상황 제시" });
    expect(contract.purpose).toContain("베란다 청소 상황 제시");
  });

  it("always includes canvas/placement/lighting/background/palette/typography/icon/whitespace/copy/cta fields", () => {
    const contract = buildCompositionContract("DETAIL");
    expect(contract.canvasRatio).toBeTruthy();
    expect(contract.focalPoint).toBeTruthy();
    expect(contract.productPlacement).toBeTruthy();
    expect(contract.cameraLighting).toBeTruthy();
    expect(contract.background).toBeTruthy();
    expect(contract.palette).toBeTruthy();
    expect(contract.typographyRole).toBeTruthy();
    expect(contract.iconRole).toBeTruthy();
    expect(contract.whitespace).toBeTruthy();
    expect(contract.copyRole).toBeTruthy();
    expect(contract.cta).toBeTruthy();
    expect(contract.imageCount).toBe(1);
  });

  it("guards against inventing components for the COMPONENTS category", () => {
    const contract = buildCompositionContract("COMPONENTS");
    expect(contract.negativeGuardrails).toContain("구성품");
  });

  it("always forbids drawing exact product text in the image", () => {
    for (const category of ["HERO", "USAGE_SCENE", "DETAIL", "FEATURE_HIGHLIGHT", "COMPONENTS", "OTHER"] as const) {
      const contract = buildCompositionContract(category);
      expect(contract.negativeGuardrails).toContain("HTML");
    }
  });
});

describe("buildCompositionPrompt", () => {
  it("assembles all contract fields into a single instruction string", () => {
    const contract = buildCompositionContract("HERO");
    const prompt = buildCompositionPrompt(contract);
    expect(prompt).toContain("Art Direction Contract");
    expect(prompt).toContain(contract.canvasRatio);
    expect(prompt).toContain(contract.palette);
    expect(prompt).toContain(contract.negativeGuardrails);
  });

  it("appends the user requirement when given, and omits it when absent", () => {
    const contract = buildCompositionContract("FEATURE_HIGHLIGHT");
    const withReq = buildCompositionPrompt(contract, "손잡이가 크게 보이게");
    expect(withReq).toContain("손잡이가 크게 보이게");
    const withoutReq = buildCompositionPrompt(contract, null);
    expect(withoutReq).not.toContain("참고 요청");
  });
});
