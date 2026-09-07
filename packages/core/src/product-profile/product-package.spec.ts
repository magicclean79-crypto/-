import type { ProductPackage, ProductProfile } from "@acos/shared";
import { buildImageGenerationPrompt, buildProductPackage } from "./product-package";
import type { ProductResearchResult } from "./product-research";

const profile: ProductProfile = {
  productName: "Magic Clean PVC 주방 매트",
  brand: "Magic Clean",
  model: "MC-100",
  material: "PVC",
  features: ["접이식", "미끄럼 방지"],
  specifications: { size: "60x90cm", weight: "800g" },
  usage: "주방 바닥에 깔아 사용",
  advantages: ["물세척 가능"],
  warnings: ["직사광선 장기 노출 금지"],
  keywords: ["주방매트"],
  confidence: 0.8,
};

describe("buildProductPackage", () => {
  it("Product Profile이 있으면 실데이터 필드를 채운다", () => {
    const result = buildProductPackage({
      profile,
      ocrText: "Magic Clean PVC Mat\nMade in Korea",
    });

    expect(result.productProfile).toEqual(profile);
    expect(result.ocrText).toBe("Magic Clean PVC Mat\nMade in Korea");
    expect(result.productName).toBe("Magic Clean PVC 주방 매트");
    expect(result.features).toEqual(["접이식", "미끄럼 방지"]);
    expect(result.specifications).toEqual({ size: "60x90cm", weight: "800g" });
  });

  it("제품 식별 정보(브랜드·모델·재질·사용목적)를 프로필에서 꺼내 담는다", () => {
    const result = buildProductPackage({ profile, ocrText: null });

    expect(result.brand).toBe("Magic Clean");
    expect(result.model).toBe("MC-100");
    expect(result.material).toBe("PVC");
    expect(result.usage).toBe("주방 바닥에 깔아 사용");
  });

  it("프로필이 없으면 제품 식별 정보도 null이다 — 지어내지 않는다", () => {
    const result = buildProductPackage({ profile: null, ocrText: null });

    expect(result.brand).toBeNull();
    expect(result.model).toBeNull();
    expect(result.material).toBeNull();
    expect(result.usage).toBeNull();
  });

  it("교차 검증(T1-23) — OCR과 GPT 분석이 같은 브랜드를 말하면 그 값을 쓴다", () => {
    const result = buildProductPackage({
      profile,
      ocrText: "제조 및 판매원 Magic Clean",
    });

    expect(result.brand).toBe("Magic Clean");
    expect(result.crossVerification?.hasConflict).toBe(false);
  });

  it("교차 검증(T1-23) — OCR과 GPT 분석이 다른 브랜드를 말하면 자동으로 채우지 않는다", () => {
    const result = buildProductPackage({
      profile,
      ocrText: "제조 및 판매원 다른회사(주)",
    });

    // 두 출처가 갈리므로 어느 쪽도 확정하지 않는다 — 사람이 판단할 몫이다.
    expect(result.brand).toBeNull();
    const brandVerification = result.crossVerification?.fields.find((f) => f.field === "brand");
    expect(brandVerification?.status).toBe("conflict");
    expect(brandVerification?.observations).toEqual([
      { source: "OCR 직접 추출", value: "다른회사(주)" },
      { source: "GPT 분석(사진+OCR 종합)", value: "Magic Clean" },
    ]);
    expect(result.crossVerification?.hasConflict).toBe(true);
  });

  it("2단계 예정 항목 5개는 항상 빈 값이다 — 지어내지 않는다", () => {
    const result = buildProductPackage({ profile, ocrText: null });

    expect(result.referenceUrls).toEqual([]);
    expect(result.benchmarkAnalysis).toBeNull();
    expect(result.designRules).toBeNull();
    expect(result.companyDesignPolicy).toBeNull();
    expect(result.learningHistory).toBeNull();
  });

  it("Product Profile이 아직 없으면(null) 실데이터 필드도 안전한 빈 값으로 채운다", () => {
    const result = buildProductPackage({ profile: null, ocrText: null });

    expect(result.productProfile).toBeNull();
    expect(result.productName).toBeNull();
    expect(result.features).toEqual([]);
    expect(result.specifications).toEqual({});
  });

  it("공식 웹 조사 결과(T1-22)를 넘기지 않으면 research는 null이다 — 지어내지 않는다", () => {
    const result = buildProductPackage({ profile, ocrText: null });

    expect(result.research).toBeNull();
  });

  it("공식 웹 조사 결과(T1-22)를 넘기면 그대로 담는다 — 값을 해석하지 않는다", () => {
    const research: ProductResearchResult = {
      status: "found",
      reason: "바코드로 공식 출처를 찾았다",
      targetsAttempted: [{ type: "barcode", query: "8804161300700", reason: "바코드" }],
      findings: [
        {
          targetType: "barcode",
          query: "8804161300700",
          sourceUrl: "https://koreannet.or.kr/product/8804161300700",
          sourceType: "official-registry",
          snippet: "Magic Clean PVC 주방 매트 8804161300700",
        },
      ],
      excluded: [
        { targetType: "brand", url: "https://danawa.com/xyz", reason: "shopping-mall" },
      ],
    };

    const result = buildProductPackage({ profile, ocrText: null, research });

    expect(result.research).toEqual(research);
  });

  it("공식 웹 조사 결과가 다른 브랜드를 언급해도 brand·model에 자동으로 반영하지 않는다", () => {
    // 스니펫에 다른 회사 이름이 들어 있어도, 그 값을 뽑아 브랜드로 쓰지
    // 않는다 — 검색 스니펫에서 값을 추출하는 것은 추측이다.
    const research: ProductResearchResult = {
      status: "found",
      reason: "브랜드로 검색",
      targetsAttempted: [{ type: "brand", query: "Magic Clean", reason: "제조·판매원" }],
      findings: [
        {
          targetType: "brand",
          query: "Magic Clean",
          sourceUrl: "https://magicclean.co.kr/about",
          sourceType: "official-homepage",
          snippet: "매직클린은 다른회사(주)의 자회사입니다.",
        },
      ],
      excluded: [],
    };

    const result = buildProductPackage({ profile, ocrText: null, research });

    expect(result.brand).toBe("Magic Clean");
    expect(result.model).toBe("MC-100");
  });

  it("사용자 요구사항(T1-92)을 넘기지 않으면 null이다 — 지어내지 않는다", () => {
    const result = buildProductPackage({ profile, ocrText: null });

    expect(result.userRequirement).toBeNull();
  });

  it("사용자 요구사항(T1-92)을 넘기면 앞뒤 공백을 정리해 담는다", () => {
    const result = buildProductPackage({
      profile,
      ocrText: null,
      userRequirement: "  더 고급스러운 느낌으로  ",
    });

    expect(result.userRequirement).toBe("더 고급스러운 느낌으로");
  });

  it("사용자 요구사항(T1-92)이 빈 문자열/공백뿐이면 null로 담는다", () => {
    const result = buildProductPackage({ profile, ocrText: null, userRequirement: "   " });

    expect(result.userRequirement).toBeNull();
  });
});

describe("buildImageGenerationPrompt", () => {
  const fullPackage: ProductPackage = {
    productProfile: profile,
    ocrText: "Magic Clean PVC Mat\nMade in Korea",
    productName: profile.productName,
    features: profile.features,
    specifications: profile.specifications,
    brand: profile.brand,
    model: profile.model,
    material: profile.material,
    usage: profile.usage,
    userRequirement: null,
    referenceUrls: [],
    benchmarkAnalysis: null,
    designRules: null,
    companyDesignPolicy: null,
    learningHistory: null,
  };

  it("제품 동일성 규칙이 가장 앞에 온다 — 품질보다 동일성이 우선", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt.startsWith("[최우선 규칙 — 제품 동일성]")).toBe(true);
    expect(prompt).toContain("사용자가 제공한 실제 제품과 동일한 제품을 생성한다");
    expect(prompt).toContain("새로운 제품을 디자인하지 않는다");
    expect(prompt).toContain("사진에 없는 구성품 생성");
    expect(prompt).toContain("[바꿔도 되는 것]");
    expect(prompt).toContain("[바꾸면 안 되는 것]");
    expect(prompt).toContain("사진에 없는 것은 만들지 않는다");
    expect(prompt).toContain("제품 식별이 가능한 특징을 유지한다");
    // 제품 정보보다 앞에 있어야 한다
    expect(prompt.indexOf("[최우선 규칙 — 제품 동일성]")).toBeLessThan(
      prompt.indexOf("[제품 정보 — 참고용]"),
    );
  });

  it("사람이 등장하면 한국인 모델이 기본이다 — 서양인 모델을 쓰지 않는다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "사용 장면을 만들어줘.");

    expect(prompt).toContain("서양인 모델을 쓰지 않는다");
    expect(prompt).toContain("기본값은 한국인 모델이다");
    expect(prompt).toContain("20~30대의 자연스럽고 세련된 한국인");
  });

  it("Product Package가 없어도 제품 동일성·한국인 모델 규칙은 붙는다", () => {
    const prompt = buildImageGenerationPrompt(null, "배경만 만들어줘.");

    expect(prompt).toContain("사용자가 제공한 실제 제품과 동일한 제품을 생성한다");
    expect(prompt).toContain("서양인 모델을 쓰지 않는다");
    expect(prompt).not.toContain("[제품 정보 — 참고용]");
  });

  it("제품 정보를 지시문 앞에 붙인다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt).toContain("제품명: Magic Clean PVC 주방 매트");
    expect(prompt).toContain("주요 특징: 접이식, 미끄럼 방지");
    expect(prompt).toContain("스펙: size 60x90cm, weight 800g");
    expect(prompt).toContain("라벨/포장 텍스트: Magic Clean PVC Mat");
    expect(prompt.endsWith("Hero 이미지를 만들어줘.")).toBe(true);
  });

  it("제품 식별 정보(브랜드·모델·재질·사용목적)를 프롬프트에 전달한다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt).toContain("브랜드: Magic Clean");
    expect(prompt).toContain("모델명: MC-100");
    expect(prompt).toContain("재질: PVC");
    expect(prompt).toContain("사용 목적: 주방 바닥에 깔아 사용");
  });

  it("제품 식별 정보가 없으면 그 줄을 만들지 않는다 — 지어내지 않는다", () => {
    const prompt = buildImageGenerationPrompt(
      { ...fullPackage, brand: null, model: null, material: null, usage: null },
      "Hero 이미지를 만들어줘.",
    );

    expect(prompt).not.toContain("브랜드:");
    expect(prompt).not.toContain("모델명:");
    expect(prompt).not.toContain("재질:");
    expect(prompt).not.toContain("사용 목적:");
    // 있는 정보는 그대로 나간다
    expect(prompt).toContain("제품명: Magic Clean PVC 주방 매트");
  });

  it("품명을 상품명처럼 전달하지 않는다 (CTO 지적, 2026-08-09)", () => {
    const prompt = buildImageGenerationPrompt(
      {
        ...fullPackage,
        productName: "베란다용 스텐 호스 세트 3M",
        identification: {
          barcodes: [],
          urls: [],
          officialProductLabel: "연질염화비닐호스",
          model: null,
          brand: null,
          origin: "한국",
          customerServicePhone: null,
          identified: false,
          identifiedBy: [],
        },
      },
      "Hero 이미지를 만들어줘.",
    );

    expect(prompt).toContain("제품명: 베란다용 스텐 호스 세트 3M");
    // "공식 품명"이라는 이름으로 넘기면 상품명이 둘인 것처럼 읽힌다
    expect(prompt).not.toContain("공식 품명");
    expect(prompt).toContain("법정 재질 분류(상품명 아님): 연질염화비닐호스");
  });

  it("같은 사실을 여러 줄에 반복하지 않는다 (CTO 지시, 2026-08-09)", () => {
    // 실측에서 나온 그대로의 상황 — 재질이 특징 자리에, 원산지·제조사가
    // 스펙 자리에 중복으로 들어와 있다.
    const prompt = buildImageGenerationPrompt(
      {
        ...fullPackage,
        productName: "베란다용 스텐 호스 세트 3M",
        brand: "삼정크린마스터(주)",
        material: "ABS, PVC, 스테인리스",
        features: ["연질염화비닐호스", "길이 3M", "다양한 분사 각도"],
        specifications: {
          원산지: "한국",
          "호스 길이": "3M",
          "제조 및 판매원": "삼정크린마스터(주)",
        },
        identification: {
          barcodes: [],
          urls: [],
          officialProductLabel: "연질염화비닐호스",
          model: null,
          brand: null,
          origin: "한국",
          customerServicePhone: null,
          identified: false,
          identifiedBy: [],
        },
      },
      "Hero 이미지를 만들어줘.",
    );

    // 재질 분류는 전용 줄에만 남고, 특징 목록에서는 빠진다
    expect(prompt).toContain("법정 재질 분류(상품명 아님): 연질염화비닐호스");
    expect(prompt).toContain("주요 특징: 길이 3M, 다양한 분사 각도");

    // 원산지·제조사는 전용 줄에만 남고, 스펙에서는 빠진다
    expect(prompt).toContain("원산지: 한국");
    expect(prompt).toContain("스펙: 호스 길이 3M");
    expect(prompt).not.toContain("스펙: 원산지 한국");
    expect(prompt).not.toContain("제조 및 판매원 삼정크린마스터");
  });

  it("빈 항목(참고 URL 등)은 프롬프트에 등장시키지 않는다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt).not.toContain("referenceUrls");
    expect(prompt).not.toContain("참고 URL");
    expect(prompt).not.toContain("벤치마크");
    expect(prompt).not.toContain("Learning History");
  });

  it("참고 URL이 채워지면 함께 전달한다 — 2단계가 오면 자동으로 흐른다", () => {
    const prompt = buildImageGenerationPrompt(
      { ...fullPackage, referenceUrls: ["https://example.com/a", "https://example.com/b"] },
      "Hero 이미지를 만들어줘.",
    );

    expect(prompt).toContain("참고 URL: https://example.com/a, https://example.com/b");
  });

  it("제품 정보를 이미지에 글자로 그리지 말라는 규칙을 항상 붙인다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt).toContain("제품명을 이미지 안에 글자로 그리지 않는다");
    expect(prompt).toContain("라벨·포장에 적힌 텍스트를 이미지 안에 글자로 넣지 않는다");
    expect(prompt).toContain("스펙표·수치·단위를 이미지 안에 글자로 넣지 않는다");
    expect(prompt).toContain("글자로 렌더링할 대상이 아니다");
    expect(prompt).toContain("형태·구조·재질·사용 방식을 정확하게 표현");
  });

  it("지시문은 항상 마지막에 온다 — 규칙이 지시문을 덮지 않는다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt.endsWith("Hero 이미지를 만들어줘.")).toBe(true);
  });

  it("제품 정보가 전혀 없어도 규칙은 붙인다 — 원본 사진에 이미 글자가 있다", () => {
    const empty: ProductPackage = {
      productProfile: null,
      ocrText: null,
      productName: null,
      features: [],
      specifications: {},
      brand: null,
      model: null,
      material: null,
      usage: null,
      userRequirement: null,
      referenceUrls: [],
      benchmarkAnalysis: null,
      designRules: null,
      companyDesignPolicy: null,
      learningHistory: null,
    };

    const prompt = buildImageGenerationPrompt(empty, "Hero 이미지를 만들어줘.");

    expect(prompt).not.toContain("[제품 정보]");
    expect(prompt).toContain("제품명을 이미지 안에 글자로 그리지 않는다");
    expect(prompt.endsWith("Hero 이미지를 만들어줘.")).toBe(true);
  });

  it("Product Package가 아예 없어도(null) 규칙과 지시문을 돌려준다", () => {
    const prompt = buildImageGenerationPrompt(null, "배경만 만들어줘.");

    expect(prompt).not.toContain("[제품 정보]");
    expect(prompt).toContain("스펙표·수치·단위를 이미지 안에 글자로 넣지 않는다");
    expect(prompt.endsWith("배경만 만들어줘.")).toBe(true);
  });

  it("사용자 요구사항(T1-92)이 없으면 그 블록을 만들지 않는다", () => {
    const prompt = buildImageGenerationPrompt(fullPackage, "Hero 이미지를 만들어줘.");

    expect(prompt).not.toContain("[사용자 요구사항");
  });

  it("사용자 요구사항(T1-92)이 있으면 그대로 전달하고, 지시문은 여전히 맨 마지막이다", () => {
    const prompt = buildImageGenerationPrompt(
      { ...fullPackage, userRequirement: "더 고급스러운 느낌으로 만들어줘" },
      "Hero 이미지를 만들어줘.",
    );

    expect(prompt).toContain("[사용자 요구사항 — 참고]");
    expect(prompt).toContain("더 고급스러운 느낌으로 만들어줘");
    expect(prompt.endsWith("Hero 이미지를 만들어줘.")).toBe(true);
    // 제품 동일성 규칙보다 뒤에 있어야 한다 — 충돌 시 제품 사실이 이긴다
    expect(prompt.indexOf("[최우선 규칙 — 제품 동일성]")).toBeLessThan(
      prompt.indexOf("[사용자 요구사항 — 참고]"),
    );
  });

  it("사용자 요구사항(T1-92)이 있으면 제품 사실과 충돌 시 무시하라는 규칙을 함께 전달한다", () => {
    const prompt = buildImageGenerationPrompt(
      { ...fullPackage, userRequirement: "제품을 빨간색으로 바꿔줘" },
      "Hero 이미지를 만들어줘.",
    );

    expect(prompt).toContain("요구사항을 무시하고 실제 제품 사실을 따른다");
  });
});
