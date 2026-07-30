/**
 * 가격 변경 감지. (TASK-3201, Sprint 32 — CTO 정책 3201-①)
 *
 * 가격 변경은 **감지 → 승인 → 적용** 절차를 씁니다. 이 파일은 첫 단계인
 * **감지**만 담당합니다.
 *
 * ## 무엇을 감지하는가 — 그리고 무엇을 감지할 수 없는가
 *
 * **Provider의 가격 공지는 읽을 수 없습니다.** 비용은 우리가 우리 가격표로
 * 계산해 기록하므로, 기록만 봐서는 "Provider가 단가를 올렸다"를 알 방법이
 * 원리적으로 없습니다. 그 사실을 감추면 이 모듈은 하지 못하는 일을 하는 척
 * 하게 됩니다.
 *
 * 대신 감지하는 것은 **기록과 지금 가격표의 불일치**입니다: 지금 단가가
 * 발효된 **뒤에** 쓰인 기록이 다른 단가를 가리키면, 그것은 사실입니다.
 * 원인은 셋 중 하나입니다.
 *
 * - **낡은 인스턴스**: 적용은 됐는데 어느 인스턴스가 옛 가격표로 계산했다
 *   (정책 3201-⑤의 무효화가 닿지 않은 상태 — 이 감지가 그 안전망입니다)
 * - **절차 우회**: 누군가 코드 기본값을 고쳐 절차 없이 단가를 바꿨다
 * - **가격표 오류**: 우리 표가 처음부터 틀렸다
 *
 * 셋 다 **사람이 판단할 일**이므로 감지는 제안까지만 만듭니다(`DETECTED`).
 * 자동 적용하지 않는 이유: 일시적 이상이나 계산 오류가 **돈의 기준**을 조용히
 * 바꿔 버리면, 그 뒤로 나오는 모든 숫자가 설명 불가능해집니다.
 *
 * ## 발효 시각 이후만 본다
 *
 * 단가를 적용한 직후에는 **그 이전에 쓰인 기록이 옛 단가**를 들고 있습니다 —
 * 당연한 일이고(Append Only, 정책 3101-②) 문제가 아닙니다. 그것을 불일치로
 * 세면 **적용할 때마다 "옛 단가로 되돌리자"는 제안이 생깁니다.** 그래서 지금
 * 단가가 발효된 시각 이후의 기록만 봅니다.
 *
 * ## 무엇을 감지하지 않는가 — 그리고 왜 말하는가
 *
 * **OCR은 단가를 정확히 계산할 수 있습니다**: 기록 1건에 `cost`와 `units`가
 * 함께 있으므로 `cost / units`가 그때 쓰인 단가입니다.
 *
 * **LLM은 가를 수 없습니다.** 비용은 `입력토큰×입력단가 + 출력토큰×출력단가`이고,
 * 기록 하나에서 미지수 둘을 풀 수 없습니다. 표본 여러 건으로 연립방정식을
 * 세울 수는 있지만, 토큰 비율이 비슷한 표본들은 **거의 특이한 행렬**이 되어
 * *그럴듯하게 틀린* 단가를 자신 있게 내놓습니다. 그래서 LLM은 **어긋났다는
 * 사실만 알리고 숫자를 만들지 않습니다** — 사람이 공지를 보고 직접 제안합니다.
 *
 * 모르는 것을 숫자로 만들지 않는다는 이 프로젝트의 기준이 여기서도 같습니다.
 */

import { estimateLlmCost, type DEFAULT_LLM_PRICING } from "../execution/execution";
import type { OcrUnitPrice } from "../ocr/ocr-pricing";

/**
 * 감지에 필요한 최소 표본 수.
 *
 * 한 건으로 단가 변경을 말하면 **반올림 오차나 한 번의 이상 응답**이 곧바로
 * 제안이 됩니다. 반대로 너무 크게 잡으면 진짜 변경을 며칠 뒤에나 알게 됩니다.
 */
export const PRICE_DETECTION_MIN_SAMPLES = 5;

/**
 * 단가가 "달라졌다"고 볼 최소 상대 차이 (1%).
 *
 * 기록은 소수 6자리로 반올림되므로 아주 작은 차이는 항상 존재합니다. 그것을
 * 변경으로 보면 감지가 매번 울리고, 매번 울리는 신호는 곧 무시됩니다.
 */
export const PRICE_DETECTION_MIN_RELATIVE_DIFF = 0.01;

/** OCR 실행 1건 (감지 입력) */
export interface OcrPriceSample {
  id: string;
  provider: string;
  units: number;
  /** 기록된 비용 (USD) — null이면 미산정이라 단가를 알 수 없다 */
  cost: number | null;
  createdAt: string;
}

/** LLM 실행 1건 (감지 입력) */
export interface LlmPriceSample {
  id: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  createdAt: string;
}

/** 감지된 단가 변경 — 그대로 제안(`DETECTED`)이 된다 */
export interface DetectedPriceChange {
  target: "ocr";
  /** OCR 엔진 이름 */
  key: string;
  /** 기록이 가리키는 단가 (USD / 단위) */
  impliedPrice: { perUnitUsd: number };
  /** 지금 가격표의 단가 */
  currentPrice: { perUnitUsd: number };
  /** 몇 건이 같은 값을 가리켰는가 */
  samples: number;
  /** 근거 (제안에 그대로 저장된다) */
  evidence: {
    from: string;
    to: string;
    sampleIds: string[];
    relativeDiff: number;
  };
  /** 사람이 읽는 근거 설명 */
  reason: string;
}

/**
 * 어긋났지만 **단가를 계산할 수 없는** 신호.
 *
 * 제안을 만들지 않습니다 — 대신 사람에게 "직접 제안을 내라"고 말합니다.
 */
export interface UnresolvedPriceSignal {
  target: "llm";
  key: string;
  provider: string;
  samples: number;
  recordedTotal: number;
  expectedTotal: number;
  relativeDiff: number;
  reason: string;
}

export interface PriceDetectionResult {
  changes: DetectedPriceChange[];
  unresolved: UnresolvedPriceSignal[];
  /** 검사한 표본 수 (OCR + LLM) */
  checked: number;
  detail: string;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

/** 상대 차이 — 기준이 0이면 절대 차이로 본다 (0 → 유료 전환도 변경이다) */
function relativeDiff(implied: number, current: number): number {
  if (current === 0) {
    return implied === 0 ? 0 : 1;
  }
  return Math.abs(implied - current) / current;
}

/**
 * OCR 기록에서 단가 변경을 찾는다 (순수 함수).
 *
 * **최근 표본이 모두 같은 단가를 가리킬 때만** 감지합니다. 평균을 쓰지 않는
 * 이유: 단가가 실제로 바뀐 직후에는 기록이 **옛 단가와 새 단가로 섞여** 있고,
 * 평균은 그 둘 사이의 **존재하지 않는 값**을 가리킵니다. 그 값을 제안으로
 * 올리면 사람은 공지에 없는 숫자를 승인하게 됩니다.
 *
 * 섞여 있으면 아직 판단하지 않습니다 — 전환이 끝나면 다음 회차에 잡힙니다.
 */
export function detectOcrPriceChanges(input: {
  /** 최신순으로 정렬된 표본 (가장 최근이 앞) */
  samples: OcrPriceSample[];
  pricing: Record<string, OcrUnitPrice>;
  /**
   * 항목별로 지금 단가가 **발효된 시각**(ISO).
   *
   * 그 이전 기록은 보지 않습니다 — 옛 단가로 쓰인 것이 당연하고, 그것을
   * 불일치로 세면 적용할 때마다 되돌리는 제안이 생깁니다.
   */
  inForceFrom?: Record<string, string>;
  minSamples?: number;
}): DetectedPriceChange[] {
  const minSamples = input.minSamples ?? PRICE_DETECTION_MIN_SAMPLES;
  const byProvider = new Map<string, OcrPriceSample[]>();
  for (const sample of input.samples) {
    // 비용이 없거나 단위가 없으면 단가를 알 수 없다 — 미산정은 별도 경보다
    if (sample.cost === null || sample.units <= 0) {
      continue;
    }
    const since = input.inForceFrom?.[sample.provider];
    if (since !== undefined && sample.createdAt < since) {
      continue; // 지금 단가가 발효되기 전의 기록
    }
    const list = byProvider.get(sample.provider) ?? [];
    list.push(sample);
    byProvider.set(sample.provider, list);
  }

  const changes: DetectedPriceChange[] = [];
  for (const [provider, samples] of byProvider) {
    const current = input.pricing[provider];
    if (current === undefined) {
      // 가격표에 아예 없는 엔진은 "변경"이 아니라 **미산정**이다
      // (unpriced-model 경보가 이미 그것을 말한다)
      continue;
    }
    const recent = samples.slice(0, minSamples);
    if (recent.length < minSamples) {
      continue;
    }
    const unit = recent.map((sample) => round(sample.cost! / sample.units));
    // 최근 표본이 한 값으로 모이지 않으면 전환 중일 수 있다 — 판단하지 않는다
    const first = unit[0];
    if (unit.some((value) => relativeDiff(value, first) > 0)) {
      continue;
    }
    const diff = relativeDiff(first, current.perUnitUsd);
    if (diff < PRICE_DETECTION_MIN_RELATIVE_DIFF) {
      continue;
    }
    const times = recent.map((sample) => sample.createdAt).sort();
    changes.push({
      target: "ocr",
      key: provider,
      impliedPrice: { perUnitUsd: first },
      currentPrice: { perUnitUsd: current.perUnitUsd },
      samples: recent.length,
      evidence: {
        from: times[0],
        to: times[times.length - 1],
        sampleIds: recent.map((sample) => sample.id),
        relativeDiff: round(diff),
      },
      reason:
        `지금 단가가 발효된 뒤 기록된 ${recent.length}건이 모두 단위당 $${first}를 ` +
        `가리킵니다 (가격표는 $${current.perUnitUsd} · 차이 ${(diff * 100).toFixed(1)}%). ` +
        "낡은 인스턴스가 옛 가격표로 계산했거나, 절차 없이 코드 기본값이 바뀌었거나, " +
        "가격표가 틀렸습니다 — 원인을 확인한 뒤 승인해 주세요.",
    });
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * LLM 기록에서 **어긋남만** 찾는다 (순수 함수) — 단가는 만들지 않는다.
 *
 * 입력·출력 단가를 가를 수 없기 때문입니다(파일 머리 설명 참조). 숫자를 지어
 * 내는 대신 **사실과 이유**를 돌려줍니다.
 */
export function detectLlmPriceSignals(input: {
  samples: LlmPriceSample[];
  pricing: typeof DEFAULT_LLM_PRICING;
  /** 모델별로 지금 단가가 발효된 시각 (ISO) — 그 이전 기록은 보지 않는다 */
  inForceFrom?: Record<string, string>;
  minSamples?: number;
}): UnresolvedPriceSignal[] {
  const minSamples = input.minSamples ?? PRICE_DETECTION_MIN_SAMPLES;
  const groups = new Map<
    string,
    { provider: string; model: string; recorded: number; expected: number; count: number }
  >();

  for (const sample of input.samples) {
    if (sample.cost === null) {
      continue; // 미산정·미기록은 비용 검증이 따로 보고한다
    }
    const since = input.inForceFrom?.[sample.model];
    if (since !== undefined && sample.createdAt < since) {
      continue; // 지금 단가가 발효되기 전의 기록
    }
    const expected = estimateLlmCost(
      sample.model,
      { inputTokens: sample.inputTokens, outputTokens: sample.outputTokens },
      input.pricing,
    );
    if (expected === null) {
      continue; // 가격표에 없는 모델 — 변경이 아니라 미산정이다
    }
    const key = `${sample.provider}/${sample.model}`;
    const group =
      groups.get(key) ??
      {
        provider: sample.provider,
        model: sample.model,
        recorded: 0,
        expected: 0,
        count: 0,
      };
    group.recorded = round(group.recorded + sample.cost);
    group.expected = round(group.expected + expected);
    group.count += 1;
    groups.set(key, group);
  }

  const signals: UnresolvedPriceSignal[] = [];
  for (const group of groups.values()) {
    if (group.count < minSamples) {
      continue;
    }
    const diff = relativeDiff(group.recorded, group.expected);
    if (diff < PRICE_DETECTION_MIN_RELATIVE_DIFF) {
      continue;
    }
    signals.push({
      target: "llm",
      key: group.model,
      provider: group.provider,
      samples: group.count,
      recordedTotal: group.recorded,
      expectedTotal: group.expected,
      relativeDiff: round(diff),
      reason:
        `지금 단가가 발효된 뒤 기록된 ${group.provider}/${group.model} ${group.count}건의 ` +
        `합계 $${group.recorded}가 가격표 재계산 $${group.expected}와 ` +
        `${(diff * 100).toFixed(1)}% 어긋납니다. ` +
        "입력·출력 단가 중 어느 것이 바뀌었는지는 기록만으로 가를 수 없습니다 — " +
        "Provider 공지를 확인해 직접 제안을 내주세요.",
    });
  }
  return signals.sort((a, b) => a.key.localeCompare(b.key));
}

/** 두 감지를 한 번에 — 예약 점검이 이것을 부른다 */
export function detectPriceChanges(input: {
  ocr: OcrPriceSample[];
  llm: LlmPriceSample[];
  pricing: {
    llm: typeof DEFAULT_LLM_PRICING;
    ocr: Record<string, OcrUnitPrice>;
  };
  /** 항목별 발효 시각 (ISO) — 그 이전 기록은 보지 않는다 */
  inForceFrom?: { llm: Record<string, string>; ocr: Record<string, string> };
  minSamples?: number;
}): PriceDetectionResult {
  const changes = detectOcrPriceChanges({
    samples: input.ocr,
    pricing: input.pricing.ocr,
    inForceFrom: input.inForceFrom?.ocr,
    minSamples: input.minSamples,
  });
  const unresolved = detectLlmPriceSignals({
    samples: input.llm,
    pricing: input.pricing.llm,
    inForceFrom: input.inForceFrom?.llm,
    minSamples: input.minSamples,
  });
  const checked = input.ocr.length + input.llm.length;
  return {
    changes,
    unresolved,
    checked,
    detail:
      `표본 ${checked}건 검사 · 감지 ${changes.length}건` +
      (unresolved.length > 0
        ? ` · 단가를 가를 수 없는 어긋남 ${unresolved.length}건` +
          " (LLM은 입력·출력 단가를 기록만으로 나눌 수 없습니다)"
        : "") +
      (changes.length > 0
        ? " — 감지는 제안까지만 만듭니다. 적용은 승인 후 사람이 합니다 (CTO 정책 3201-①)."
        : ""),
  };
}
