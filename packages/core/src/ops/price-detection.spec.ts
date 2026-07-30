import { DEFAULT_LLM_PRICING } from "../execution/execution";
import { DEFAULT_OCR_PRICING } from "../ocr/ocr-pricing";
import {
  PRICE_DETECTION_MIN_SAMPLES,
  detectLlmPriceSignals,
  detectOcrPriceChanges,
  detectPriceChanges,
} from "./price-detection";
import type { LlmPriceSample, OcrPriceSample } from "./price-detection";

/** 같은 단가를 가리키는 OCR 표본 n건 (최신순) */
const ocrSamples = (
  unitPrice: number,
  count = PRICE_DETECTION_MIN_SAMPLES,
  provider = "google-vision",
): OcrPriceSample[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `o-${index}`,
    provider,
    units: 1,
    cost: unitPrice,
    createdAt: `2026-08-0${index + 1}T00:00:00.000Z`,
  }));

const llmSample = (
  overrides: Partial<LlmPriceSample> = {},
): LlmPriceSample => ({
  id: "e-1",
  provider: "openai",
  model: "gpt-4o",
  inputTokens: 1_000_000,
  outputTokens: 0,
  // gpt-4o 입력 $2.5/1M
  cost: 2.5,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("가격 변경 감지 (TASK-3201, CTO 정책 3201-①)", () => {
  describe("OCR — 단가를 정확히 계산할 수 있다", () => {
    it("최근 표본이 모두 같은 새 단가를 가리키면 감지한다", () => {
      const changes = detectOcrPriceChanges({
        samples: ocrSamples(0.002),
        pricing: DEFAULT_OCR_PRICING,
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].impliedPrice).toEqual({ perUnitUsd: 0.002 });
      expect(changes[0].currentPrice).toEqual({ perUnitUsd: 0.0015 });
      expect(changes[0].samples).toBe(PRICE_DETECTION_MIN_SAMPLES);
      // 근거가 붙는다 — 사람은 근거를 보고 승인한다
      expect(changes[0].evidence.sampleIds).toHaveLength(
        PRICE_DETECTION_MIN_SAMPLES,
      );
      expect(changes[0].reason).toContain("원인을 확인한 뒤 승인해 주세요");
    });

    it("가격표와 같으면 감지하지 않는다", () => {
      expect(
        detectOcrPriceChanges({
          samples: ocrSamples(0.0015),
          pricing: DEFAULT_OCR_PRICING,
        }),
      ).toEqual([]);
    });

    it("표본이 적으면 판단하지 않는다 — 한 건은 이상 응답일 수 있다", () => {
      expect(
        detectOcrPriceChanges({
          samples: ocrSamples(0.002, PRICE_DETECTION_MIN_SAMPLES - 1),
          pricing: DEFAULT_OCR_PRICING,
        }),
      ).toEqual([]);
    });

    it("옛 단가와 새 단가가 섞여 있으면 판단하지 않는다", () => {
      // 평균을 쓰면 **존재하지 않는 값**($0.00175)이 제안으로 올라가고,
      // 사람은 공지에 없는 숫자를 승인하게 된다
      const mixed = [
        ...ocrSamples(0.002, 3),
        ...ocrSamples(0.0015, 3).map((sample, index) => ({
          ...sample,
          id: `old-${index}`,
        })),
      ];
      expect(
        detectOcrPriceChanges({ samples: mixed, pricing: DEFAULT_OCR_PRICING }),
      ).toEqual([]);
    });

    it("전환이 끝나면 다음 회차에 잡힌다", () => {
      // 최신순 앞쪽이 모두 새 단가가 되면 감지된다
      const settled = [
        ...ocrSamples(0.002, PRICE_DETECTION_MIN_SAMPLES),
        ...ocrSamples(0.0015, 3).map((sample, index) => ({
          ...sample,
          id: `old-${index}`,
        })),
      ];
      const changes = detectOcrPriceChanges({
        samples: settled,
        pricing: DEFAULT_OCR_PRICING,
      });
      expect(changes[0].impliedPrice.perUnitUsd).toBe(0.002);
    });

    it("1% 미만 차이는 감지하지 않는다 — 반올림 오차로 매번 울린다", () => {
      expect(
        detectOcrPriceChanges({
          samples: ocrSamples(0.001505),
          pricing: DEFAULT_OCR_PRICING,
        }),
      ).toEqual([]);
    });

    it("비용이 없는 기록은 단가를 알려 주지 않는다", () => {
      const unpriced = ocrSamples(0.002).map((sample) => ({
        ...sample,
        cost: null,
      }));
      expect(
        detectOcrPriceChanges({
          samples: unpriced,
          pricing: DEFAULT_OCR_PRICING,
        }),
      ).toEqual([]);
    });

    it("지금 단가가 발효되기 전의 기록은 보지 않는다", () => {
      // 적용 직후에는 그 이전 기록이 옛 단가를 들고 있는 것이 당연하다
      // (Append Only) — 그것을 불일치로 세면 **적용할 때마다 되돌리는
      // 제안**이 생긴다
      const old = ocrSamples(0.0015).map((sample, index) => ({
        ...sample,
        id: `old-${index}`,
        createdAt: `2026-07-0${index + 1}T00:00:00.000Z`,
      }));
      expect(
        detectOcrPriceChanges({
          samples: old,
          // 가격표는 이미 $0.002로 바뀌어 있다
          pricing: { "google-vision": { perUnitUsd: 0.002, note: "적용됨" } },
          inForceFrom: { "google-vision": "2026-07-20T00:00:00.000Z" },
        }),
      ).toEqual([]);
    });

    it("발효 이후 기록이 어긋나면 감지한다 — 낡은 인스턴스·절차 우회의 신호다", () => {
      const after = ocrSamples(0.0015).map((sample, index) => ({
        ...sample,
        id: `after-${index}`,
        createdAt: `2026-08-0${index + 1}T00:00:00.000Z`,
      }));
      const changes = detectOcrPriceChanges({
        samples: after,
        pricing: { "google-vision": { perUnitUsd: 0.002, note: "적용됨" } },
        inForceFrom: { "google-vision": "2026-07-20T00:00:00.000Z" },
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].impliedPrice.perUnitUsd).toBe(0.0015);
      // 원인을 하나로 단정하지 않는다 — 셋 다 사람이 확인할 일이다
      expect(changes[0].reason).toContain("낡은 인스턴스");
      expect(changes[0].reason).toContain("절차 없이 코드 기본값이 바뀌었거나");
    });

    it("가격표에 없는 엔진은 변경이 아니라 미산정이다", () => {
      // unpriced-model 경보가 이미 그것을 말한다 — 여기서 또 부르지 않는다
      expect(
        detectOcrPriceChanges({
          samples: ocrSamples(0.002, PRICE_DETECTION_MIN_SAMPLES, "clova"),
          pricing: DEFAULT_OCR_PRICING,
        }),
      ).toEqual([]);
    });

    it("무료였던 엔진이 과금으로 바뀌면 감지한다", () => {
      const changes = detectOcrPriceChanges({
        samples: ocrSamples(0.001, PRICE_DETECTION_MIN_SAMPLES, "tesseract"),
        pricing: DEFAULT_OCR_PRICING,
      });
      expect(changes[0].currentPrice.perUnitUsd).toBe(0);
      expect(changes[0].impliedPrice.perUnitUsd).toBe(0.001);
    });

    it("단위가 여러 개인 기록도 단가를 나눈다", () => {
      const bulk = ocrSamples(0.002).map((sample) => ({
        ...sample,
        units: 4,
        cost: 0.008,
      }));
      expect(
        detectOcrPriceChanges({ samples: bulk, pricing: DEFAULT_OCR_PRICING })[0]
          .impliedPrice.perUnitUsd,
      ).toBe(0.002);
    });
  });

  describe("LLM — 단가를 가를 수 없으므로 숫자를 만들지 않는다", () => {
    const drifted = Array.from({ length: PRICE_DETECTION_MIN_SAMPLES }, (_, i) =>
      llmSample({ id: `e-${i}`, cost: 3 }),
    );

    it("어긋남을 사실로 알리되 제안할 단가는 내지 않는다", () => {
      const signals = detectLlmPriceSignals({
        samples: drifted,
        pricing: DEFAULT_LLM_PRICING,
      });
      expect(signals).toHaveLength(1);
      expect(signals[0].recordedTotal).toBe(15);
      expect(signals[0].expectedTotal).toBe(12.5);
      // 단가를 지어내지 않는다 — 결과에 impliedPrice가 없다
      expect(signals[0]).not.toHaveProperty("impliedPrice");
      expect(signals[0].reason).toContain("가를 수 없습니다");
      expect(signals[0].reason).toContain("직접 제안을 내주세요");
    });

    it("맞으면 조용하다", () => {
      expect(
        detectLlmPriceSignals({
          samples: Array.from({ length: PRICE_DETECTION_MIN_SAMPLES }, (_, i) =>
            llmSample({ id: `e-${i}` }),
          ),
          pricing: DEFAULT_LLM_PRICING,
        }),
      ).toEqual([]);
    });

    it("가격표에 없는 모델은 변경이 아니라 미산정이다", () => {
      expect(
        detectLlmPriceSignals({
          samples: Array.from({ length: PRICE_DETECTION_MIN_SAMPLES }, (_, i) =>
            llmSample({ id: `e-${i}`, model: "gpt-9", cost: 5 }),
          ),
          pricing: DEFAULT_LLM_PRICING,
        }),
      ).toEqual([]);
    });

    it("비용이 기록되지 않은 호출은 세지 않는다", () => {
      expect(
        detectLlmPriceSignals({
          samples: Array.from({ length: PRICE_DETECTION_MIN_SAMPLES }, (_, i) =>
            llmSample({ id: `e-${i}`, cost: null }),
          ),
          pricing: DEFAULT_LLM_PRICING,
        }),
      ).toEqual([]);
    });

    it("표본이 적으면 판단하지 않는다", () => {
      expect(
        detectLlmPriceSignals({
          samples: drifted.slice(0, 2),
          pricing: DEFAULT_LLM_PRICING,
        }),
      ).toEqual([]);
    });

    it("발효 이전 기록은 보지 않는다", () => {
      expect(
        detectLlmPriceSignals({
          samples: drifted,
          pricing: DEFAULT_LLM_PRICING,
          inForceFrom: { "gpt-4o": "2026-09-01T00:00:00.000Z" },
        }),
      ).toEqual([]);
    });
  });

  describe("한 번에 감지", () => {
    it("감지와 미해결 신호를 함께 돌려주고, 적용이 아니라고 말한다", () => {
      const result = detectPriceChanges({
        ocr: ocrSamples(0.002),
        llm: Array.from({ length: PRICE_DETECTION_MIN_SAMPLES }, (_, i) =>
          llmSample({ id: `e-${i}`, cost: 3 }),
        ),
        pricing: { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING },
      });
      expect(result.changes).toHaveLength(1);
      expect(result.unresolved).toHaveLength(1);
      expect(result.checked).toBe(PRICE_DETECTION_MIN_SAMPLES * 2);
      // 감지는 제안까지만 만든다 — 자동 적용은 없다
      expect(result.detail).toContain("적용은 승인 후 사람이 합니다");
    });

    it("아무것도 어긋나지 않으면 조용하다", () => {
      const result = detectPriceChanges({
        ocr: ocrSamples(0.0015),
        llm: [],
        pricing: { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING },
      });
      expect(result.changes).toEqual([]);
      expect(result.detail).not.toContain("적용은 승인 후");
    });

    it("마크다운 강조가 새지 않는다", () => {
      const result = detectPriceChanges({
        ocr: ocrSamples(0.002),
        llm: [],
        pricing: { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING },
      });
      expect(result.detail).not.toContain("**");
      expect(result.changes[0].reason).not.toContain("**");
    });
  });
});
