import { estimateLlmCost } from "../execution/execution";
import {
  pricedModels,
  verifyCosts,
  verifyOcrCosts,
} from "./cost-verification";
import type { CostSample, OcrCostSample } from "./cost-verification";

function sample(overrides: Partial<CostSample> = {}): CostSample {
  const model = overrides.model ?? "gpt-4o";
  // `??`를 쓰면 명시한 null이 기본값으로 되살아난다 — undefined만 기본값으로
  const inputTokens =
    overrides.inputTokens !== undefined ? overrides.inputTokens : 1000;
  const outputTokens =
    overrides.outputTokens !== undefined ? overrides.outputTokens : 500;
  return {
    id: overrides.id ?? "exec-1",
    provider: overrides.provider ?? "openai",
    model,
    inputTokens,
    outputTokens,
    cost:
      overrides.cost !== undefined
        ? overrides.cost
        : estimateLlmCost(model, { inputTokens, outputTokens }),
    createdAt: overrides.createdAt ?? "2026-07-28T00:00:00.000Z",
  };
}

describe("Cost Verification (TASK-1301)", () => {
  it("가격표와 일치하면 문제 없음", () => {
    const result = verifyCosts([
      sample({ id: "e1" }),
      sample({ id: "e2", model: "claude-sonnet-5", provider: "anthropic" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checked).toBe(2);
    // gpt-4o: 1000*2.5/1M + 500*10/1M = 0.0025 + 0.005 = 0.0075
    // sonnet-5: 1000*3/1M + 500*15/1M = 0.003 + 0.0075 = 0.0105
    expect(result.recordedTotal).toBeCloseTo(0.018, 6);
    expect(result.expectedTotal).toBeCloseTo(0.018, 6);
  });

  it("가격표에 없는 모델은 unpriced — 예산 상한이 무력화된다고 알린다", () => {
    const result = verifyCosts([
      sample({ id: "e1", model: "gpt-5-preview", cost: null }),
      sample({ id: "e2", model: "gpt-5-preview", cost: null }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.unpricedCalls).toBe(2);
    const issue = result.issues.find((entry) => entry.kind === "unpriced")!;
    expect(issue).toMatchObject({ model: "gpt-5-preview", count: 2 });
    // 화면에 평문으로 찍히므로 마크다운 강조를 넣지 않는다
    expect(issue.message).toContain("예산 상한이 적용되지 않습니다");
    expect(issue.message).not.toContain("**");
    expect(issue.sampleIds).toEqual(["e1", "e2"]);
  });

  it("기록된 비용이 재계산과 다르면 mismatch (기록·기대 합계 제시)", () => {
    const result = verifyCosts([
      sample({ id: "e1", cost: 0.05 }), // 기대 0.0075
    ]);
    const issue = result.issues.find((entry) => entry.kind === "mismatch")!;
    expect(issue).toMatchObject({
      model: "gpt-4o",
      count: 1,
      recordedTotal: 0.05,
    });
    expect(issue.expectedTotal).toBeCloseTo(0.0075, 6);
  });

  it("토큰이 없으면 unpriced가 아니라 missing-usage로 구분한다", () => {
    // 조치가 다르다 — 가격표 등록 vs Provider 응답 확인
    const result = verifyCosts([
      sample({ id: "e1", inputTokens: null, outputTokens: null, cost: null }),
    ]);
    expect(result.unpricedCalls).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: "missing-usage",
      count: 1,
    });
  });

  it("스냅샷 모델명도 접두사 매칭으로 검증된다", () => {
    const result = verifyCosts([
      sample({ id: "e1", model: "gpt-4o-2024-08-06" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.expectedTotal).toBeCloseTo(0.0075, 6);
  });

  it("반올림 오차(소수 6자리)는 불일치로 보지 않는다", () => {
    const expected = estimateLlmCost("gpt-4o", {
      inputTokens: 1234,
      outputTokens: 567,
    })!;
    const result = verifyCosts([
      sample({
        id: "e1",
        inputTokens: 1234,
        outputTokens: 567,
        cost: expected + 0.000_001,
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it("모델·Provider 단위로 묶어 보고한다", () => {
    const result = verifyCosts([
      sample({ id: "e1", model: "x-model", provider: "openai", cost: null }),
      sample({ id: "e2", model: "x-model", provider: "openai", cost: null }),
      sample({ id: "e3", model: "y-model", provider: "anthropic", cost: null }),
    ]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((issue) => issue.count).sort()).toEqual([1, 2]);
  });

  it("빈 표본은 통과", () => {
    expect(verifyCosts([])).toMatchObject({
      ok: true,
      checked: 0,
      recordedTotal: 0,
      expectedTotal: 0,
    });
  });

  it("pricedModels — 등록된 단가 목록을 돌려준다", () => {
    const models = pricedModels();
    expect(models.map((entry) => entry.model)).toEqual(
      expect.arrayContaining([
        "gpt-4o",
        "gpt-4o-mini",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5",
        "gemini-2.5-flash",
      ]),
    );
  });
});

describe("OCR 비용 검증 (TASK-3001, CTO 결정 2901-④)", () => {
  const sample = (
    id: string,
    provider: string,
    cost: number | null,
    units = 1,
  ): OcrCostSample => ({
    id,
    provider,
    units,
    cost,
    createdAt: "2026-07-30T00:00:00.000Z",
  });

  it("맞는 비용은 문제로 보지 않는다", () => {
    const result = verifyOcrCosts([
      sample("o-1", "google-vision", 0.0015),
      sample("o-2", "google-vision", 0.003, 2),
      sample("o-3", "mock", 0),
    ]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.recordedTotal).toBe(0.0045);
    expect(result.expectedTotal).toBe(0.0045);
  });

  it("가격표에 없는 엔진은 미산정으로 알린다", () => {
    // 비용이 예산 계산에서 빠지므로 상한이 조용히 무력해진다
    const result = verifyOcrCosts([sample("o-1", "clova", null)]);
    expect(result.ok).toBe(false);
    expect(result.unpricedCalls).toBe(1);
    expect(result.issues[0]).toMatchObject({
      kind: "unpriced",
      provider: "clova",
      model: "text-detection",
      count: 1,
    });
    expect(result.issues[0].message).toContain("예산 상한이 적용되지 않습니다");
  });

  it("기록과 재계산이 다르면 불일치로 알린다", () => {
    const result = verifyOcrCosts([sample("o-1", "google-vision", 0.5)]);
    expect(result.issues[0]).toMatchObject({
      kind: "mismatch",
      recordedTotal: 0.5,
      expectedTotal: 0.0015,
    });
  });

  it("LLM 검증과 같은 결과 모양을 돌려준다", () => {
    // 모양이 갈라지면 화면·경보가 한쪽만 다루는 사각이 생긴다
    const ocr = verifyOcrCosts([sample("o-1", "google-vision", 0.0015)]);
    expect(Object.keys(ocr).sort()).toEqual([
      "checked",
      "expectedTotal",
      "issues",
      "ok",
      "recordedTotal",
      "unpricedCalls",
    ]);
  });

  it("표본이 없으면 문제도 없다", () => {
    expect(verifyOcrCosts([])).toMatchObject({ ok: true, checked: 0 });
  });
});

describe("기록되지 않은 비용은 불일치가 아니다 (TASK-3001, 라이브 발견)", () => {
  it("LLM: 산정 가능한데 비용이 null이면 unrecorded다", () => {
    // "기록 $0 vs 기대 $0.0075"라고 말하면 기록된 값이 다르다는 뜻이 되어
    // 사실과 어긋난다 — 기록이 없는 것과 0이 기록된 것은 다르다
    const result = verifyCosts([sample({ id: "e1", cost: null })]);
    const issue = result.issues[0];
    expect(issue.kind).toBe("unrecorded");
    expect(issue.message).toContain("기록되지 않았습니다");
    expect(issue.expectedTotal).toBe(0.0075);
    // 불일치로 세지 않는다
    expect(result.issues.some((entry) => entry.kind === "mismatch")).toBe(false);
  });

  it("OCR: 비용 편입 이전 실행도 unrecorded다", () => {
    const result = verifyOcrCosts([
      {
        id: "o-1",
        provider: "google-vision",
        units: 1,
        cost: null,
        createdAt: "2026-07-30T00:00:00.000Z",
      },
    ]);
    expect(result.issues[0]).toMatchObject({
      kind: "unrecorded",
      provider: "google-vision",
      expectedTotal: 0.0015,
    });
  });

  it("0이 기록된 것은 문제가 아니다 — 과금 없는 엔진이다", () => {
    const result = verifyOcrCosts([
      {
        id: "o-1",
        provider: "mock",
        units: 1,
        cost: 0,
        createdAt: "2026-07-30T00:00:00.000Z",
      },
    ]);
    expect(result.ok).toBe(true);
  });
});
