import { rankReferenceImages, type ReferenceCandidate } from "./product-reference-hierarchy";

describe("rankReferenceImages", () => {
  it("prioritizes real HERO/DETAIL/COMPONENTS photos over untagged real photos and generated images", () => {
    const candidates: ReferenceCandidate[] = [
      { id: "generated-1", category: null, isReal: false, order: 1 },
      { id: "real-untagged", category: null, isReal: true, order: 2 },
      { id: "real-components", category: "COMPONENTS", isReal: true, order: 3 },
      { id: "real-detail", category: "DETAIL", isReal: true, order: 4 },
      { id: "real-hero", category: "HERO", isReal: true, order: 5 },
      { id: "real-other", category: "OTHER", isReal: true, order: 6 },
    ];
    const ranked = rankReferenceImages(candidates);
    expect(ranked.map((r) => r.id)).toEqual([
      "real-hero",
      "real-detail",
      "real-components",
      "real-untagged",
      "real-other",
      "generated-1",
    ]);
  });

  it("keeps stable order (by `order`) within the same priority tier", () => {
    const candidates: ReferenceCandidate[] = [
      { id: "hero-b", category: "HERO", isReal: true, order: 20 },
      { id: "hero-a", category: "HERO", isReal: true, order: 10 },
    ];
    const ranked = rankReferenceImages(candidates);
    expect(ranked.map((r) => r.id)).toEqual(["hero-a", "hero-b"]);
  });

  it("explains why each candidate was ranked where it was", () => {
    const ranked = rankReferenceImages([{ id: "x", category: "HERO", isReal: true, order: 0 }]);
    expect(ranked[0].reason).toContain("HERO");
  });

  it("never invents priority for excluded (INFO) photos — callers are expected to filter them out before ranking", () => {
    // 이 함수는 INFO 필터링을 하지 않는다 — 그 책임은 상위 계층
    // (ImageGenService.assertNotInfoImage, photoType: "DESIGN" 쿼리)에
    // 있다. 여기서는 이미 걸러진 후보만 들어온다는 계약을 문서로 남긴다.
    const ranked = rankReferenceImages([{ id: "design-only", category: null, isReal: true, order: 0 }]);
    expect(ranked).toHaveLength(1);
  });
});
