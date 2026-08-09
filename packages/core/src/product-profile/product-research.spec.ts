import { identifyProduct } from "./product-identification";
import {
  classifyResearchSource,
  filterOfficialResults,
  planProductResearch,
} from "./product-research";

/** 실제 Benchmark(베란다용 스텐 호스 세트 3M) OCR 원문 — 2026-08-08 실측값 */
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

const identification = identifyProduct({ ocrText: BENCHMARK_OCR });

describe("planProductResearch — 제품이 식별된 경우에만 수행", () => {
  it("식별되지 않았으면 조사 계획이 비어 있다", () => {
    const unidentified = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    expect(unidentified.identified).toBe(false);
    expect(planProductResearch(unidentified)).toEqual([]);
  });

  it("바코드 → 모델명 → 브랜드 → 홈페이지 → 카탈로그 순서로 계획한다", () => {
    const withModel = identifyProduct({
      ocrText: BENCHMARK_OCR + "\n모델명 SJC-3000",
    });
    const targets = planProductResearch(withModel);
    expect(targets.map((t) => t.type)).toEqual([
      "barcode",
      "model",
      "brand",
      "homepage",
      "catalog",
    ]);
    expect(targets[0].query).toBe("8804161300700");
  });

  it("모델명이 없는 Benchmark 실측에서는 모델 단계를 건너뛴다", () => {
    const targets = planProductResearch(identification);
    expect(targets.map((t) => t.type)).toEqual(["barcode", "brand", "homepage", "catalog"]);
  });

  it("찾은 정보가 적을수록 계획도 짧다 — 없는 것을 지어내 계획에 넣지 않는다", () => {
    const brandOnly = identifyProduct({
      ocrText: "제조 및 판매원 삼정크린마스터(주)\n품명 연질염화비닐호스",
    });
    expect(brandOnly.identified).toBe(true); // 브랜드 + 품명
    const targets = planProductResearch(brandOnly);
    expect(targets.map((t) => t.type)).toEqual(["brand"]);
  });
});

describe("classifyResearchSource — 공식 출처만 인정한다", () => {
  it("쇼핑몰은 무조건 shopping-mall이다 (M-20-1)", () => {
    expect(classifyResearchSource("https://www.danawa.com/product/1234", identification)).toBe(
      "shopping-mall",
    );
    expect(classifyResearchSource("https://item.gmarket.co.kr/Item?goodscode=1", identification)).toBe(
      "shopping-mall",
    );
    expect(classifyResearchSource("https://www.coupang.com/vp/products/1", identification)).toBe(
      "shopping-mall",
    );
  });

  it("포장지에서 읽은 제조사 홈페이지와 같은 호스트만 official-homepage다", () => {
    expect(classifyResearchSource("https://www.samjeongcm.co.kr", identification)).toBe(
      "official-homepage",
    );
    expect(
      classifyResearchSource("https://www.samjeongcm.co.kr/products/hose", identification),
    ).toBe("official-homepage");
  });

  it("같은 호스트라도 카탈로그 경로면 official-catalog다", () => {
    expect(
      classifyResearchSource("https://www.samjeongcm.co.kr/catalog/2026.pdf", identification),
    ).toBe("official-catalog");
  });

  it("공인 바코드 조회 기관은 official-registry다 (M-21)", () => {
    expect(
      classifyResearchSource("https://www.koreannet.or.kr/product/8804161300700", identification),
    ).toBe("official-registry");
  });

  it("브랜드 이름이 그럴듯하게 들어간 도메인이라도 검증 못 하면 unverified다", () => {
    // M-21 사고 재현: 같은 브랜드의 다른 규격(5m) 제품이 상위 검색 결과로
    // 나왔던 사례 — 도메인이 브랜드와 무관해도 "그럴듯하다"만으로는 인정하지 않는다.
    expect(
      classifyResearchSource("https://some-blog.example.com/samjeongcm-review", identification),
    ).toBe("unverified");
  });

  it("URL을 해석할 수 없으면 unverified다", () => {
    expect(classifyResearchSource("not a url", identification)).toBe("unverified");
  });
});

describe("filterOfficialResults — 버리되 흔적은 남긴다", () => {
  const target = { type: "brand" as const, query: "삼정크린마스터(주)", reason: "브랜드" };

  it("공식 출처만 findings에 남고 나머지는 excluded에 근거와 함께 남는다", () => {
    const { findings, excluded } = filterOfficialResults(
      target,
      [
        { url: "https://www.samjeongcm.co.kr/about", snippet: "삼정크린마스터(주) 소개" },
        { url: "https://www.danawa.com/product/999", snippet: "베란다 호스 5M 최저가" },
        { url: "https://blog.example.com/review", snippet: "써봤어요" },
      ],
      identification,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      targetType: "brand",
      query: "삼정크린마스터(주)",
      sourceUrl: "https://www.samjeongcm.co.kr/about",
      sourceType: "official-homepage",
      snippet: "삼정크린마스터(주) 소개",
    });

    expect(excluded).toEqual([
      { targetType: "brand", url: "https://www.danawa.com/product/999", reason: "shopping-mall" },
      { targetType: "brand", url: "https://blog.example.com/review", reason: "unverified-source" },
    ]);
  });

  it("결과가 없으면 findings·excluded 모두 빈 배열이다", () => {
    const { findings, excluded } = filterOfficialResults(target, [], identification);
    expect(findings).toEqual([]);
    expect(excluded).toEqual([]);
  });
});
