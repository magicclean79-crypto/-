import { extractOcrArrayFactCandidates, extractOcrFactCandidates } from "./ocr-facts-extraction";

describe("extractOcrFactCandidates", () => {
  it("라벨이 붙은 스칼라 필드를 사진별로 뽑는다", () => {
    const candidates = extractOcrFactCandidates([
      {
        assetId: "a1",
        text: "베란다용 스텐 호스 세트 3M\n제조 및 판매원 상성산업(주)\n원산지 대한민국\n규격 3M",
        confidence: 0.92,
      },
    ]);

    expect(candidates).toContainEqual({
      assetId: "a1",
      field: "manufacturer",
      value: "상성산업(주)",
      confidence: 0.92,
    });
    expect(candidates).toContainEqual({
      assetId: "a1",
      field: "originCountry",
      value: "대한민국",
      confidence: 0.92,
    });
    expect(candidates).toContainEqual({
      assetId: "a1",
      field: "dimensions",
      value: "3M",
      confidence: 0.92,
    });
  });

  it("같은 필드가 사진마다 다르면 각 사진의 값을 그대로 각각 후보로 남긴다(자동으로 고르지 않는다)", () => {
    const candidates = extractOcrFactCandidates([
      { assetId: "a1", text: "제조 및 판매원 상성산업(주)", confidence: 0.9 },
      { assetId: "a2", text: "제조 및 판매원 상부산업(주)", confidence: 0.85 },
    ]);

    const manufacturerValues = candidates.filter((c) => c.field === "manufacturer").map((c) => c.value);
    expect(manufacturerValues).toEqual(["상성산업(주)", "상부산업(주)"]);
  });

  it("라벨 없이 상호만 단독으로 적혀 있으면 '(주)'·'㈜' 표기 관례로 제조사 후보를 뽑는다(실측 재현: T1-196 benchmark asset)", () => {
    const candidates = extractOcrFactCandidates([
      {
        assetId: "a3",
        text: "베란다용\n스텐 호스 세트 3M\nVeranda Stainless Hose Set 3M\n삼정크린마스터(주)",
        confidence: null,
      },
    ]);
    expect(candidates).toContainEqual({
      assetId: "a3",
      field: "manufacturer",
      value: "삼정크린마스터(주)",
      confidence: null,
    });
  });

  it("라벨이 있으면 상호 표기 관례보다 라벨을 우선한다", () => {
    const candidates = extractOcrFactCandidates([
      { assetId: "a1", text: "제조 및 판매원 상성산업(주)\n판매처 다른회사(주)", confidence: null },
    ]);
    const manufacturer = candidates.find((c) => c.field === "manufacturer");
    expect(manufacturer?.value).toBe("상성산업(주)");
  });

  it("라벨을 찾지 못하면 후보를 만들지 않는다(지어내지 않는다)", () => {
    const candidates = extractOcrFactCandidates([{ assetId: "a1", text: "아무 글자도 없는 사진", confidence: null }]);
    expect(candidates).toEqual([]);
  });

  it("빈 텍스트는 건너뛴다", () => {
    expect(extractOcrFactCandidates([{ assetId: "a1", text: "   ", confidence: null }])).toEqual([]);
  });
});

describe("extractOcrArrayFactCandidates", () => {
  it("소재·구성품을 구분자로 나눠 배열로 뽑는다", () => {
    const candidates = extractOcrArrayFactCandidates([
      { assetId: "a1", text: "재질 ABS, PVC, 스테인리스\n구성품 분사기, 호스, 고무패킹 2개" },
    ]);

    expect(candidates).toContainEqual({ assetId: "a1", field: "materials", values: ["ABS", "PVC", "스테인리스"] });
    expect(candidates).toContainEqual({
      assetId: "a1",
      field: "includedComponents",
      values: ["분사기", "호스", "고무패킹 2개"],
    });
  });

  it("주의사항 구간을 다음 라벨 전까지만 뽑는다", () => {
    const candidates = extractOcrArrayFactCandidates([
      {
        assetId: "a1",
        text: "주의사항\n고온에 노출하지 마세요\n어린이 손이 닿지 않게 보관하세요\n품명 연질염화비닐호스",
      },
    ]);

    const cautions = candidates.find((c) => c.field === "cautions");
    expect(cautions?.values).toEqual(["고온에 노출하지 마세요", "어린이 손이 닿지 않게 보관하세요"]);
  });

  it("라벨이 없으면 빈 결과다", () => {
    expect(extractOcrArrayFactCandidates([{ assetId: "a1", text: "그냥 사진 설명" }])).toEqual([]);
  });
});
