import { buildProductFactsPanel, type ProductFactsPanelInput } from "./product-story-facts-panel";

function baseInput(overrides: Partial<ProductFactsPanelInput> = {}): ProductFactsPanelInput {
  return {
    profile: {
      brand: "삼정크린마스터",
      model: "SJ-100",
      material: "ABS, PVC, 스테인리스",
      specifications: { 길이: "3M" },
      features: ["분사기 손잡이"],
      usage: "베란다에서 물을 뿌려 청소할 때 사용",
      warnings: ["어린이 손이 닿지 않는 곳에 보관하세요"],
    },
    identification: { origin: "한국" },
    components: ["호스 본체", "고무 패킹 2개"],
    ...overrides,
  };
}

describe("buildProductFactsPanel", () => {
  it("검증된 브랜드·모델·재질·원산지·규격을 제품 사양 표에 렌더링한다", () => {
    const result = buildProductFactsPanel(baseInput());
    expect(result).not.toBeNull();
    expect(result!.html).toContain("삼정크린마스터");
    expect(result!.html).toContain("SJ-100");
    expect(result!.html).toContain("ABS, PVC, 스테인리스");
    expect(result!.html).toContain("한국");
    expect(result!.html).toContain("3M");
  });

  it("구성품은 실제 Vision이 확인한 목록만 렌더링한다", () => {
    const result = buildProductFactsPanel(baseInput());
    expect(result!.html).toContain("호스 본체");
    expect(result!.html).toContain("고무 패킹 2개");
  });

  it("주의사항이 있으면 별도 강조 블록으로 렌더링한다", () => {
    const result = buildProductFactsPanel(baseInput());
    expect(result!.html).toContain("사용상 주의사항");
    expect(result!.html).toContain("어린이 손이 닿지 않는 곳에 보관하세요");
    expect(result!.html).toContain("pde-facts-block--warning");
  });

  it("값이 없는 항목은 지어내지 않고 그 항목 자체를 표시하지 않는다", () => {
    const result = buildProductFactsPanel(
      baseInput({
        profile: {
          brand: null,
          model: null,
          material: null,
          specifications: {},
          features: [],
          usage: null,
          warnings: [],
        },
        identification: { origin: null },
        components: [],
      }),
    );
    expect(result).toBeNull();
  });

  it("일부 필드만 있어도 있는 값만 표시하고 없는 항목은 생략한다", () => {
    const result = buildProductFactsPanel(
      baseInput({
        profile: {
          brand: null,
          model: null,
          material: "스테인리스",
          specifications: {},
          features: [],
          usage: null,
          warnings: [],
        },
        identification: { origin: null },
        components: [],
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("스테인리스");
    expect(result!.html).not.toContain("구성품");
    expect(result!.html).not.toContain("사용상 주의사항");
  });

  it("specifications에 '구성품' 키가 있어도 구성품 목록과 중복 표시하지 않는다", () => {
    const result = buildProductFactsPanel(
      baseInput({
        profile: {
          brand: null,
          model: null,
          material: null,
          specifications: { 색상: "검정, 은색", 구성품: "스프레이 건, 고무 패킹 2개, 메탈 호스" },
          features: [],
          usage: null,
          warnings: [],
        },
        identification: { origin: null },
        components: ["스프레이 건", "고무 패킹 2개", "메탈 호스"],
      }),
    );
    expect(result!.html).toContain("검정, 은색");
    // "구성품" 라벨은 구성품 섹션 제목으로 한 번만 나오고, 사양 표 라벨로는 나오지 않는다
    expect(result!.html.match(/pde-facts-label">구성품</g)).toBeNull();
  });

  it("HTML 특수문자를 이스케이프한다", () => {
    const result = buildProductFactsPanel(
      baseInput({
        profile: {
          brand: "A&B <Corp>",
          model: null,
          material: null,
          specifications: {},
          features: [],
          usage: null,
          warnings: [],
        },
      }),
    );
    expect(result!.html).toContain("A&amp;B &lt;Corp&gt;");
    expect(result!.html).not.toContain("<Corp>");
  });
});
