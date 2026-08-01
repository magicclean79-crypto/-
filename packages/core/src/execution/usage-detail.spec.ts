// `estimateLlmCostDetailed`는 `execution.ts`에 있습니다 — 가격표와 같은
// 파일이어야 순환 의존이 생기지 않습니다.
import { estimateLlmCost, estimateLlmCostDetailed } from "./execution";
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  NO_USAGE_DETAIL,
  describeUsage,
  describeUsagePricing,
  hasUsageDetail,
  totalInputTokens,
} from "./usage-detail";

const PRICING = {
  "test-model": { inputPerMillion: 10, outputPerMillion: 100 },
};

describe("estimateLlmCostDetailed (TASK-4701)", () => {
  /**
   * 가장 중요한 성질이다. 새 셈을 과거에 소급하면 지금까지의 모든 기록이
   * "불일치"로 뜨고(비용 기록은 Append Only다), 진짜 불일치가 그 소음에
   * 묻힌다.
   */
  it("상세가 없으면 예전 셈과 한 푼도 다르지 않다", () => {
    const usage = { inputTokens: 1000, outputTokens: 500 };
    for (const detail of [null, undefined, NO_USAGE_DETAIL]) {
      expect(estimateLlmCostDetailed("test-model", usage, detail, PRICING)).toBe(
        estimateLlmCost("test-model", usage, PRICING),
      );
    }
  });

  it("캐시에서 읽은 입력은 1/10로 센다", () => {
    const cost = estimateLlmCostDetailed(
      "test-model",
      { inputTokens: 0, outputTokens: 0 },
      { cachedInputTokens: 1_000_000, cacheWriteTokens: null, reasoningTokens: null },
      PRICING,
    );
    expect(cost).toBeCloseTo(10 * CACHE_READ_MULTIPLIER, 6);
  });

  /**
   * 캐시는 공짜로 생기지 않는다 — 처음 한 번은 오히려 비싸다. 이 배율을
   * 1로 두면 캐시를 켠 첫날 비용이 왜 늘었는지 아무도 설명하지 못한다.
   */
  it("캐시에 쓴 입력은 기본보다 비싸게 센다", () => {
    const cost = estimateLlmCostDetailed(
      "test-model",
      { inputTokens: 0, outputTokens: 0 },
      { cachedInputTokens: null, cacheWriteTokens: 1_000_000, reasoningTokens: null },
      PRICING,
    );
    expect(cost).toBeCloseTo(10 * CACHE_WRITE_MULTIPLIER, 6);
    expect(CACHE_WRITE_MULTIPLIER).toBeGreaterThan(1);
  });

  /**
   * 생각 토큰은 이미 출력 토큰 안에 들어 있다 — 따로 곱하면 두 번 센다.
   */
  it("생각 토큰을 따로 곱하지 않는다", () => {
    const withReasoning = estimateLlmCostDetailed(
      "test-model",
      { inputTokens: 100, outputTokens: 1000 },
      { cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 900 },
      PRICING,
    );
    const withoutReasoning = estimateLlmCostDetailed(
      "test-model",
      { inputTokens: 100, outputTokens: 1000 },
      { cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
      PRICING,
    );
    expect(withReasoning).toBe(withoutReasoning);
  });

  it("가격표에 없는 모델은 상세가 있어도 null이다", () => {
    expect(
      estimateLlmCostDetailed(
        "모르는-모델",
        { inputTokens: 100, outputTokens: 100 },
        { cachedInputTokens: 100, cacheWriteTokens: 0, reasoningTokens: 0 },
        PRICING,
      ),
    ).toBeNull();
  });

  it("토큰을 모르면 상세가 있어도 null이다", () => {
    expect(
      estimateLlmCostDetailed(
        "test-model",
        { inputTokens: null, outputTokens: null },
        { cachedInputTokens: 100, cacheWriteTokens: 0, reasoningTokens: 0 },
        PRICING,
      ),
    ).toBeNull();
  });

  /**
   * 세 Provider가 틀리는 방향이 다르다 — 그래서 합계는 어느 쪽으로도 못
   * 믿는다. 캐시가 많이 걸린 호출을 예전 셈으로 세면 실제보다 **적게**
   * 나온다(Anthropic 모양).
   */
  it("캐시가 걸린 호출은 예전 셈보다 비싸게 나온다 (덜 세고 있었다)", () => {
    const usage = { inputTokens: 100, outputTokens: 100 };
    const old = estimateLlmCost("test-model", usage, PRICING) ?? 0;
    const now =
      estimateLlmCostDetailed(
        "test-model",
        usage,
        { cachedInputTokens: 900_000, cacheWriteTokens: 0, reasoningTokens: null },
        PRICING,
      ) ?? 0;
    expect(now).toBeGreaterThan(old);
  });
});

describe("hasUsageDetail", () => {
  it("하나라도 알면 true", () => {
    expect(hasUsageDetail(NO_USAGE_DETAIL)).toBe(false);
    expect(hasUsageDetail(null)).toBe(false);
    expect(hasUsageDetail(undefined)).toBe(false);
    expect(
      hasUsageDetail({ cachedInputTokens: 0, cacheWriteTokens: null, reasoningTokens: null }),
    ).toBe(true);
  });
});

describe("totalInputTokens", () => {
  it("모르면 null이고 0으로 채우지 않는다", () => {
    expect(totalInputTokens({ inputTokens: null }, NO_USAGE_DETAIL)).toBeNull();
  });

  it("캐시까지 개수로 더한다", () => {
    expect(
      totalInputTokens(
        { inputTokens: 100 },
        { cachedInputTokens: 50, cacheWriteTokens: 20, reasoningTokens: null },
      ),
    ).toBe(170);
  });

  it("상세가 없으면 입력 토큰 그대로", () => {
    expect(totalInputTokens({ inputTokens: 100 }, NO_USAGE_DETAIL)).toBe(100);
  });
});

describe("describeUsage", () => {
  it("모르면 모른다고 말한다", () => {
    expect(describeUsage({ inputTokens: null, outputTokens: 5 }, null)).toContain(
      "알 수 없습니다",
    );
  });

  /**
   * 캐시가 잘 걸린 날은 입력 토큰이 갑자기 줄어든 것처럼 보인다 — 그걸 보고
   * "프롬프트가 짧아졌나" 하고 엉뚱한 데를 찾게 된다.
   */
  it("캐시가 걸린 것을 문장에 드러낸다", () => {
    const text = describeUsage(
      { inputTokens: 100, outputTokens: 200 },
      { cachedInputTokens: 900, cacheWriteTokens: 0, reasoningTokens: 150 },
    );
    expect(text).toContain("캐시 읽기");
    expect(text).toContain("생각");
  });

  it("상세가 없으면 캐시 이야기를 하지 않는다", () => {
    const text = describeUsage({ inputTokens: 100, outputTokens: 200 }, NO_USAGE_DETAIL);
    expect(text).not.toContain("캐시");
  });
});

describe("describeUsagePricing", () => {
  it("배율을 숨기지 않는다", () => {
    const rows = describeUsagePricing();
    expect(rows.map((row) => row.multiplier)).toContain(CACHE_READ_MULTIPLIER);
    expect(rows.map((row) => row.multiplier)).toContain(CACHE_WRITE_MULTIPLIER);
  });
});
