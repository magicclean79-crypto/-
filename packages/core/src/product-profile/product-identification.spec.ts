import { identifyProduct, isValidGtin } from "./product-identification";

/**
 * 실제 Benchmark(베란다용 스텐 호스 세트 3M)의 OCR 원문 일부.
 * 지어낸 문자열이 아니라 **2026-08-08 실측값**이다 — 실제로 OCR이 이렇게
 * 읽는다(공백이 끼고, 자릿수가 하나 더 붙는다).
 */
const BENCHMARK_OCR = `베란다용
스텐 호스 세트 3M
Veranda Stainless Hose Set 3M
삼정크린마스터(주)

품질표시
품명 연질염화비닐호스
(베란다용 스텐 호스 세트 3M)
종류 일반용 재질 ABS, PVC, 스테인리스
규격호스길이 3M 원산지 한국
제조 및 판매원 삼정크린마스터(주)
경기도 김포시 대곶면 대곶북로 513-2
고객상담실 031-997-7829
8804161 3007001
www.samjeongcm.co.kr.`;

describe("isValidGtin — 아무 숫자열이나 바코드로 믿지 않는다", () => {
  it("실제 제품 바코드를 통과시킨다", () => {
    expect(isValidGtin("8804161300700")).toBe(true);
  });

  it("체크디짓이 틀린 숫자는 거부한다", () => {
    expect(isValidGtin("8804161300701")).toBe(false);
  });

  it("전화번호처럼 자릿수가 맞지 않으면 거부한다", () => {
    expect(isValidGtin("0319977829")).toBe(false);
  });

  it("숫자가 아니면 거부한다", () => {
    expect(isValidGtin("88041613007a0")).toBe(false);
  });
});

describe("identifyProduct — Benchmark 실측 OCR", () => {
  const result = identifyProduct({ ocrText: BENCHMARK_OCR });

  it("공백이 끼고 자릿수가 덧붙은 바코드를 찾아낸다", () => {
    // OCR 원문은 "8804161 3007001" — 공백이 있고 끝에 1이 더 붙어 있다
    expect(result.barcodes).toHaveLength(1);
    expect(result.barcodes[0]).toEqual({
      value: "8804161300700",
      format: "GTIN-13",
      checkDigitValid: true,
    });
  });

  it("제조사 홈페이지 주소를 찾아낸다 — 문장부호는 떼어 낸다", () => {
    expect(result.urls.map((u) => u.value)).toContain("www.samjeongcm.co.kr");
  });

  it("품명·브랜드·원산지·상담전화를 라벨에서 읽는다", () => {
    expect(result.officialProductLabel).toBe("연질염화비닐호스");
    expect(result.brand).toBe("삼정크린마스터(주)");
    expect(result.origin).toBe("한국");
    expect(result.customerServicePhone).toBe("031-997-7829");
  });

  it("모델명이 없으면 null이다 — 제품명을 옮겨 적지 않는다", () => {
    // 이 제품 포장지에는 모델 번호가 없다. 지어내면 안 된다.
    expect(result.model).toBeNull();
  });

  it("바코드가 있으므로 제품이 특정된 것으로 본다", () => {
    expect(result.identified).toBe(true);
    expect(result.identifiedBy).toContain("바코드");
    expect(result.identifiedBy).toContain("브랜드");
  });
});

describe("품명은 상품명이 아니다 (CTO 지적, 2026-08-09)", () => {
  it("품질표시의 '품명'을 상품명으로 쓰지 않는다", () => {
    const r = identifyProduct({ ocrText: BENCHMARK_OCR });

    // 포장지 품질표시의 "품명"은 법정 재질 분류다.
    expect(r.officialProductLabel).toBe("연질염화비닐호스");
    // 실제 상품명은 라벨 앞면의 "베란다용 스텐 호스 세트 3M"이며,
    // 이 함수는 상품명을 정하지 않는다 — 상품명 필드 자체가 없다.
    expect(r).not.toHaveProperty("productName");
  });
});

describe("identifyProduct — 지어내지 않는다", () => {
  it("아무것도 없으면 전부 null·빈 배열이고 특정되지 않았다고 답한다", () => {
    const r = identifyProduct({ ocrText: null });

    expect(r.barcodes).toEqual([]);
    expect(r.urls).toEqual([]);
    expect(r.model).toBeNull();
    expect(r.brand).toBeNull();
    expect(r.identified).toBe(false);
    expect(r.identifiedBy).toEqual([]);
  });

  it("브랜드만 있고 품명·모델이 없으면 특정으로 보지 않는다", () => {
    const r = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });

    expect(r.brand).toBe("삼정크린마스터(주)");
    expect(r.identified).toBe(false);
  });

  it("체크디짓이 틀린 숫자는 바코드로 담지 않는다", () => {
    const r = identifyProduct({ ocrText: "인증번호 8804161300701" });

    expect(r.barcodes).toEqual([]);
  });

  it("Vision 텍스트만으로는 바코드를 인정하지 않는다 — 포장지 글자만 믿는다", () => {
    const r = identifyProduct({ ocrText: null, visionText: "바코드는 8804161300700 처럼 보인다" });

    expect(r.barcodes).toEqual([]);
  });
});

describe("identifyProduct — 모델명 추출", () => {
  it("라벨이 붙어 있으면 그대로 읽는다", () => {
    expect(identifyProduct({ ocrText: "모델명 MC-100" }).model).toBe("MC-100");
    expect(identifyProduct({ ocrText: "품번: SJ-3000A" }).model).toBe("SJ-3000A");
  });

  it("라벨이 없어도 전형적인 품번 형태는 인정한다", () => {
    expect(identifyProduct({ ocrText: "제품 SJC-2024 사용설명서" }).model).toBe("SJC-2024");
  });

  it("OCR에 없으면 Vision에서 찾는다 — OCR이 우선이다", () => {
    const r = identifyProduct({ ocrText: "모델명 MC-100", visionText: "모델명 XX-999" });
    expect(r.model).toBe("MC-100");
  });
});
