import { identifyProduct } from "@acos/core";
import type { RawResearchResult, ResearchTarget } from "@acos/core";
import { ProductResearchService } from "./product-research.service";
import type { WebResearchProvider } from "./web-research-provider";

/** 실제 Benchmark(베란다용 스텐 호스 세트 3M) OCR 원문 — 2026-08-08 실측값 */
const BENCHMARK_OCR = `베란다용
스텐 호스 세트 3M
삼정크린마스터(주)
품질표시
품명 연질염화비닐호스
제조 및 판매원 삼정크린마스터(주)
고객상담실 031-997-7829
8804161 3007001
www.samjeongcm.co.kr.`;

function fakeProvider(byQuery: Record<string, RawResearchResult[]>): WebResearchProvider & {
  calls: ResearchTarget[];
} {
  const calls: ResearchTarget[] = [];
  return {
    name: "fake",
    calls,
    async search(target: ResearchTarget) {
      calls.push(target);
      return byQuery[target.query] ?? [];
    },
  };
}

describe("ProductResearchService — 제품이 식별된 경우에만 수행", () => {
  it("식별되지 않았으면 조사 자체를 생략하고 Provider를 호출하지 않는다", async () => {
    const provider = fakeProvider({});
    const service = new ProductResearchService(provider);

    const unidentified = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    const result = await service.research(unidentified);

    expect(result.status).toBe("skipped");
    expect(provider.calls).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("바코드 단계에서 공식 출처를 찾으면 이후 단계(브랜드·홈페이지)는 조사하지 않는다", async () => {
    const identification = identifyProduct({ ocrText: BENCHMARK_OCR });
    const provider = fakeProvider({
      "8804161300700": [
        { url: "https://www.samjeongcm.co.kr/product/hose", snippet: "베란다용 스텐 호스 세트 3M" },
      ],
    });
    const service = new ProductResearchService(provider);

    const result = await service.research(identification);

    expect(result.status).toBe("found");
    expect(provider.calls.map((t) => t.type)).toEqual(["barcode"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].sourceType).toBe("official-homepage");
  });

  it("상위 단계가 전부 실패하면 다음 단계로 넘어간다", async () => {
    const identification = identifyProduct({ ocrText: BENCHMARK_OCR });
    const provider = fakeProvider({
      "8804161300700": [{ url: "https://www.danawa.com/x", snippet: "최저가 비교" }],
      "삼정크린마스터(주) 연질염화비닐호스": [
        { url: "https://www.samjeongcm.co.kr", snippet: "삼정크린마스터 공식 홈페이지" },
      ],
    });
    const service = new ProductResearchService(provider);

    const result = await service.research(identification);

    expect(provider.calls.map((t) => t.type)).toEqual(["barcode", "brand"]);
    expect(result.status).toBe("found");
    expect(result.findings[0].targetType).toBe("brand");
    // 바코드 단계의 쇼핑몰 결과는 findings가 아니라 excluded에 남는다
    expect(result.excluded).toContainEqual({
      targetType: "barcode",
      url: "https://www.danawa.com/x",
      reason: "shopping-mall",
    });
  });

  it("모든 단계에서 공식 출처를 못 찾으면 not_found다 — 지어내지 않는다", async () => {
    const identification = identifyProduct({ ocrText: BENCHMARK_OCR });
    const provider = fakeProvider({});
    const service = new ProductResearchService(provider);

    const result = await service.research(identification);

    expect(result.status).toBe("not_found");
    expect(result.findings).toEqual([]);
    // 계획된 모든 단계를 시도했다 (바코드·브랜드·홈페이지·카탈로그)
    expect(provider.calls.length).toBeGreaterThan(1);
  });

  it("Provider가 none이면 예산을 확인하지 않는다 — 비용이 없기 때문이다", async () => {
    const identification = identifyProduct({ ocrText: BENCHMARK_OCR });
    const assertWithinBudget = jest.fn().mockResolvedValue(undefined);
    const provider: WebResearchProvider = { name: "none", search: async () => [] };
    const service = new ProductResearchService(provider, {
      assertWithinBudget,
    } as unknown as import("../llm/llm-budget.service").LlmBudgetService);

    await service.research(identification);

    expect(assertWithinBudget).not.toHaveBeenCalled();
  });

  it("실제 검색 Provider가 켜져 있으면 조사 전에 예산을 확인한다", async () => {
    const identification = identifyProduct({ ocrText: BENCHMARK_OCR });
    const assertWithinBudget = jest.fn().mockResolvedValue(undefined);
    const provider = fakeProvider({});
    const service = new ProductResearchService(provider, {
      assertWithinBudget,
    } as unknown as import("../llm/llm-budget.service").LlmBudgetService);

    await service.research(identification);

    expect(assertWithinBudget).toHaveBeenCalledWith({ what: "제품 자동 조사(웹 검색)" });
  });
});
