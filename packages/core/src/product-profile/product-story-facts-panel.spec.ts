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

  it("specifications에 '원산지'/'제조국' 키가 있어도 원산지/제조국 행과 중복 표시하지 않는다(T1-162)", () => {
    const result = buildProductFactsPanel(
      baseInput({
        profile: {
          brand: null,
          model: null,
          material: null,
          specifications: { 색상: "검정, 은색", 원산지: "중국", 제조국: "중국" },
          features: [],
          usage: null,
          warnings: [],
        },
        identification: { origin: "한국" },
        components: [],
      }),
    );
    expect(result!.html).toContain("검정, 은색");
    expect(result!.html).toContain('<span class="pde-facts-label">원산지/제조국</span>');
    // 사양 표에는 "원산지/제조국" 전용 행만 한 번 있어야 하고, specifications의
    // "원산지"·"제조국" 키가 별도 행으로 다시 나오면 안 된다.
    expect(result!.html.match(/pde-facts-label">원산지\/제조국</g)).toHaveLength(1);
    expect(result!.html).not.toContain('pde-facts-label">원산지</span>');
    expect(result!.html).not.toContain('pde-facts-label">제조국</span>');
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

/**
 * canonical 템플릿 회귀 테스트 (T1-146). 벤치마크(호스 세트)와 완전히
 * 다른 카테고리 상품으로 같은 함수를 호출해, 데이터만 바뀌고 구조·
 * CSS/layout token은 상품이 달라져도 그대로임을 고정한다 — 실제 유료
 * 파이프라인을 새로 돌리지 않고(비용 없음) 순수 함수 입력만 바꿔
 * 검증한다.
 */
describe("buildProductFactsPanel — 다른 카테고리 상품(mock)에서도 canonical 템플릿 유지", () => {
  function secondProductInput(overrides: Partial<ProductFactsPanelInput> = {}): ProductFactsPanelInput {
    return {
      profile: {
        brand: "우리손칼",
        model: "WSC-7K",
        material: "스테인리스 스틸, 폴리프로필렌",
        specifications: { 칼날길이: "20cm", 무게: "180g" },
        features: ["한 번 갈아 오래 쓰는 내구성", "손잡이 논슬립 그립"],
        usage: "주방에서 육류·채소 손질에 사용",
        warnings: ["날카로운 칼날에 베이지 않도록 주의하세요", "식기세척기 사용을 피하세요"],
      },
      identification: { origin: "대한민국" },
      components: ["칼 본체", "칼집"],
      ...overrides,
    };
  }

  it("호스 세트(벤치마크)와 전혀 다른 상품이어도 4개 섹션 제목·순서가 동일하다", () => {
    const benchmark = buildProductFactsPanel(baseInput());
    const other = buildProductFactsPanel(secondProductInput());
    expect(benchmark).not.toBeNull();
    expect(other).not.toBeNull();

    const headingOrder = (html: string) =>
      Array.from(html.matchAll(/<h3 class="pde-facts-heading">(.*?)<\/h3>/g)).map((m) =>
        m[1].replace(/<[^>]+>/g, "").trim(),
      );
    expect(headingOrder(other!.html)).toEqual(["제품 사양", "구성품", "주요 기능/용도", "사용상 주의사항"]);
    expect(headingOrder(other!.html)).toEqual(headingOrder(benchmark!.html));
  });

  it("상품이 달라져도 CSS(layout token)는 완전히 동일하다 — 데이터만 바뀐다", () => {
    const benchmark = buildProductFactsPanel(baseInput());
    const other = buildProductFactsPanel(secondProductInput());
    expect(other!.css).toBe(benchmark!.css);
  });

  it("2열 라벨/값 사양표 구조를 그대로 재사용한다", () => {
    const other = buildProductFactsPanel(secondProductInput());
    expect(other!.html).toContain('class="pde-facts-grid"');
    expect(other!.html).toContain('class="pde-facts-row"');
    expect(other!.html).toContain("칼날길이");
    expect(other!.html).toContain("20cm");
    expect(other!.html).toContain("우리손칼");
    expect(other!.html).toContain("WSC-7K");
  });

  it("주의사항 강조 박스와 검증 안내 문구를 상품이 달라져도 동일하게 붙인다", () => {
    const other = buildProductFactsPanel(secondProductInput());
    expect(other!.html).toContain("pde-facts-block--warning");
    expect(other!.html).toContain("날카로운 칼날에 베이지 않도록 주의하세요");
    expect(other!.html).toContain("위 정보는 검증된 내용만 표시합니다");
  });

  it("모바일→데스크톱 반응형 breakpoint(760px)를 유지한다", () => {
    const other = buildProductFactsPanel(secondProductInput());
    expect(other!.css).toContain("@media (min-width: 760px)");
    expect(other!.css).toContain(".pde-facts-row { grid-template-columns: 200px 1fr");
  });
});
