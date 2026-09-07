import type { ProductProfile } from "@acos/shared";
import { buildDesignDirectorInput, buildDesignDirectorPrompt, selectCompositionFamily } from "./design-director";

function mockProfile(overrides: Partial<ProductProfile> = {}): ProductProfile {
  return {
    productName: "베란다용 스텐 호스 세트 3M",
    brand: "삼정크린마스터(주)",
    model: null,
    material: "ABS, PVC, 스테인리스",
    features: ["3M 신축 호스", "분사 패턴 조절 트리거"],
    specifications: { 길이: "3M", 재질: "ABS/PVC/스테인리스" },
    usage: "베란다·정원 청소용 물뿌리개",
    advantages: ["가볍고 튼튼함"],
    warnings: ["직사광선 노출 시 변형 가능"],
    keywords: ["호스", "청소", "베란다"],
    confidence: 0.9,
    ...overrides,
  };
}

describe("design-director — buildDesignDirectorInput", () => {
  it("검증된 ProductProfile 필드만 골라낸다 — warnings/confidence는 포함하지 않는다", () => {
    const input = buildDesignDirectorInput(mockProfile());
    expect(input).toEqual({
      productName: "베란다용 스텐 호스 세트 3M",
      brand: "삼정크린마스터(주)",
      material: "ABS, PVC, 스테인리스",
      features: ["3M 신축 호스", "분사 패턴 조절 트리거"],
      specifications: { 길이: "3M", 재질: "ABS/PVC/스테인리스" },
      usage: "베란다·정원 청소용 물뿌리개",
      advantages: ["가볍고 튼튼함"],
      keywords: ["호스", "청소", "베란다"],
    });
    expect(input).not.toHaveProperty("warnings");
    expect(input).not.toHaveProperty("confidence");
  });
});

describe("design-director — buildDesignDirectorPrompt", () => {
  it("system 메시지가 이미지 생성/편집 작업이 아님을 명시한다", () => {
    const messages = buildDesignDirectorPrompt(buildDesignDirectorInput(mockProfile()));
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).toMatch(/이미지를 생성하거나 편집하는 작업이 아니다/);
  });

  it("user 메시지가 OCR 원문·이미지 바이트를 참조하지 않고 검증된 필드만 담는다", () => {
    const messages = buildDesignDirectorPrompt(buildDesignDirectorInput(mockProfile()));
    const user = messages.find((m) => m.role === "user");
    expect(user?.content).toContain("베란다용 스텐 호스 세트 3M");
    expect(user?.content).toContain("삼정크린마스터(주)");
    expect(user?.content).not.toContain("data:image");
    expect(user?.content).not.toContain("base64");
  });

  it("허용된 어휘(visualStyle 5종, colorway 등)를 프롬프트에 명시한다", () => {
    const messages = buildDesignDirectorPrompt(buildDesignDirectorInput(mockProfile()));
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("industrial-premium");
    expect(user).toContain("editorial-minimal");
    expect(user).toContain("modern-utility");
    expect(user).toContain("soft-premium");
    expect(user).toContain("technical-performance");
  });

  it("서로 다른 두 제품은 서로 다른 프롬프트를 만든다 — 제품 특성이 실제로 입력에 반영된다", () => {
    const hose = buildDesignDirectorPrompt(buildDesignDirectorInput(mockProfile()));
    const babyProduct = buildDesignDirectorPrompt(
      buildDesignDirectorInput(
        mockProfile({
          productName: "유아용 파스텔 실리콘 식판",
          brand: null,
          material: "식품용 실리콘",
          features: ["흡착 바닥", "칸막이 구조"],
          usage: "이유식·유아 식사용",
          advantages: ["부드러운 촉감", "전자레인지 사용 가능"],
          keywords: ["유아", "식판", "실리콘"],
        }),
      ),
    );
    const hoseUser = hose.find((m) => m.role === "user")!.content;
    const babyUser = babyProduct.find((m) => m.role === "user")!.content;
    expect(hoseUser).not.toBe(babyUser);
    expect(hoseUser).toContain("베란다용 스텐 호스 세트 3M");
    expect(babyUser).toContain("유아용 파스텔 실리콘 식판");
  });

  it("응답은 JSON 객체 하나만 출력하라고 명시한다", () => {
    const messages = buildDesignDirectorPrompt(buildDesignDirectorInput(mockProfile()));
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toMatch(/JSON 객체 하나만 출력/);
  });
});

describe("design-director — selectCompositionFamily (T1-183/T1-185, 최소 6개 family)", () => {
  it("사양 8개 이상 + 짧은 사용 설명 → technical-catalog", () => {
    const input = buildDesignDirectorInput(
      mockProfile({
        specifications: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6", g: "7", h: "8" },
        usage: "실외용",
      }),
    );
    expect(selectCompositionFamily(input)).toBe("technical-catalog");
  });

  it("기능·사양·장점이 모두 적음 → minimal-lifestyle", () => {
    const input = buildDesignDirectorInput(
      mockProfile({
        features: ["가벼움"],
        specifications: { 색상: "화이트" },
        advantages: ["휴대 간편"],
      }),
    );
    expect(selectCompositionFamily(input)).toBe("minimal-lifestyle");
  });

  it("장점이 4개 이상이고 사양보다 많음 → bold-statement", () => {
    const input = buildDesignDirectorInput(
      mockProfile({
        specifications: { 색상: "화이트", 무게: "500g" },
        advantages: ["가볍다", "튼튼하다", "예쁘다", "세척이 쉽다"],
      }),
    );
    expect(selectCompositionFamily(input)).toBe("bold-statement");
  });

  it("중간 밀도 사양(4~7개) + 사용 설명 있음 → compact-utility", () => {
    const input = buildDesignDirectorInput(
      mockProfile({
        specifications: { 길이: "3M", 재질: "PVC", 무게: "300g", 색상: "블루", 원산지: "한국" },
        usage: "베란다·정원용",
        advantages: ["가볍고 튼튼함"],
      }),
    );
    expect(selectCompositionFamily(input)).toBe("compact-utility");
  });

  it("기능(features) 6개 이상 → gallery-forward", () => {
    const input = buildDesignDirectorInput(
      mockProfile({
        features: ["기능1", "기능2", "기능3", "기능4", "기능5", "기능6"],
        specifications: { 색상: "화이트", 무게: "500g" },
        advantages: ["가볍다"],
      }),
    );
    expect(selectCompositionFamily(input)).toBe("gallery-forward");
  });

  it("어느 분기에도 해당하지 않는 일반 생활용품(benchmark 패턴) → editorial-brochure(기본값)", () => {
    const input = buildDesignDirectorInput(
      mockProfile({
        features: ["3M 신축 호스", "분사 패턴 조절 트리거", "인체공학 손잡이", "논슬립 그립"],
        specifications: { 길이: "3M", 재질: "ABS/PVC/스테인리스", 무게: "450g" },
        advantages: ["가볍고 튼튼함", "설치가 쉬움"],
        usage: "베란다·정원 청소용 물뿌리개",
      }),
    );
    expect(selectCompositionFamily(input)).toBe("editorial-brochure");
  });
});
