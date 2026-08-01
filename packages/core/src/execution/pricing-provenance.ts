/**
 * 단가의 출처와 나이. (TASK-4701, Sprint 47 — 지시 5 "가격표 보강")
 *
 * ## 표에 값이 있다는 것과 그 값이 맞다는 것은 다릅니다
 *
 * `DEFAULT_LLM_PRICING`은 숫자만 가지고 있었습니다. 그래서 화면에 뜨는
 * "$0.0123"을 보고 아무도 **그 단가가 언제 것인지** 물을 수 없었습니다.
 * 단가는 조용히 바뀝니다 — 바뀐 날 우리 표는 아무 일도 일어나지 않고,
 * 그 뒤로 우리가 내는 모든 비용 숫자는 **틀렸는데 초록색**입니다.
 *
 * 그래서 값 옆에 **언제 것인지와 어디서 온 것인지**를 둡니다. 이 파일은
 * 단가를 바꾸지 않습니다 — 단가 자체는 `DEFAULT_LLM_PRICING`이 그대로
 * 가지고 있고, 여기는 **그 숫자를 얼마나 믿을 수 있는지**만 말합니다.
 *
 * ## 모르는 단가를 채우지 않았습니다
 *
 * 표에 없는 모델을 "대충 비슷한 모델 값"으로 채우고 싶은 유혹이 있습니다.
 * 그러면 미산정 경보가 사라지고 화면이 초록이 됩니다. **그 초록은 거짓말
 * 입니다** — 근거 없는 숫자로 낸 비용은 없는 것보다 나쁩니다. 없으면
 * "모른다"가 보이지만, 지어내면 아무도 다시 확인하지 않습니다.
 *
 * 대신 표에 없는 모델이 **불린 순간 이름과 건수로 드러나게** 했습니다
 * (`reportUnpricedModels`). 채우는 것은 사람이 근거를 들고 하는 일이며,
 * 이 저장소에는 이미 그 절차(제안 → 검토 → 승인 → 적용)가 있습니다.
 */

/** 단가 하나의 출처 */
export interface PriceProvenance {
  /** 이 단가를 확인한 날 (YYYY-MM-DD) */
  asOf: string;
  /** 어디서 왔는가 — 사람이 다시 찾아갈 수 있어야 한다 */
  source: string;
}

/**
 * 단가를 믿을 수 있는 기간.
 *
 * 180일을 고른 이유는 "이 정도면 안전하다"가 아니라 **"이 정도 지나면
 * 사람이 한 번은 봐야 한다"** 입니다. 짧게 잡으면 경고가 상시가 되어
 * 아무도 안 보고, 길게 잡으면 바뀐 단가로 반년을 셉니다.
 */
export const PRICE_STALE_AFTER_DAYS = 180;

/**
 * 모델별 단가 출처.
 *
 * 여기에 없는 모델은 **출처를 모르는 단가**입니다 — 표에는 있지만 언제
 * 것인지 아무도 모른다는 뜻이고, 그 사실이 화면에 그대로 뜹니다.
 */
export const LLM_PRICE_PROVENANCE: Record<string, PriceProvenance> = {
  "mock-llm-1": {
    asOf: "2026-08-01",
    source: "가짜 엔진 — 외부 호출이 없어 과금 0. 확인이 필요 없는 유일한 항목입니다.",
  },
  "gpt-4o": { asOf: "2026-08-01", source: "OpenAI 공개 요금표 (TASK-0603에서 등록)" },
  "gpt-4o-mini": { asOf: "2026-08-01", source: "OpenAI 공개 요금표 (TASK-0603에서 등록)" },
  "claude-opus-5": { asOf: "2026-08-01", source: "Anthropic 공개 요금표 (TASK-0903에서 등록)" },
  "claude-sonnet-5": { asOf: "2026-08-01", source: "Anthropic 공개 요금표 (TASK-0903에서 등록)" },
  "claude-haiku-4-5": { asOf: "2026-08-01", source: "Anthropic 공개 요금표 (TASK-0903에서 등록)" },
  "gemini-2.5-flash": { asOf: "2026-08-01", source: "Google 공개 요금표 (TASK-0903에서 등록)" },
};

export type PriceFreshness = "fresh" | "stale" | "unknown-source";

export interface PriceFreshnessRow {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  freshness: PriceFreshness;
  /** 며칠 된 단가인가 — 출처를 모르면 null */
  ageDays: number | null;
  asOf: string | null;
  source: string | null;
  /** 사람이 할 일 — 할 게 없으면 null */
  next: string | null;
}

export interface PriceFreshnessReport {
  rows: PriceFreshnessRow[];
  fresh: number;
  stale: number;
  unknownSource: number;
  /** 한 줄 요약 — 못 믿는 것을 **먼저** 말한다 */
  summary: string;
}

/**
 * 가격표의 나이를 판정한다 (순수 함수).
 *
 * **오래된 단가를 틀렸다고 말하지 않습니다.** 오래됐다는 것은 "바뀌었다"가
 * 아니라 **"확인한 지 오래됐다"** 입니다 — 그 둘을 뭉치면 멀쩡한 단가에
 * 사람을 부르게 되고, 사람은 곧 그 경고를 끕니다.
 */
export function judgePriceFreshness(
  pricing: Record<string, { inputPerMillion: number; outputPerMillion: number }>,
  now: number,
  provenance: Record<string, PriceProvenance> = LLM_PRICE_PROVENANCE,
): PriceFreshnessReport {
  const rows: PriceFreshnessRow[] = Object.entries(pricing)
    .map(([model, price]) => {
      const known = provenance[model];
      if (!known) {
        return {
          model,
          ...price,
          freshness: "unknown-source" as const,
          ageDays: null,
          asOf: null,
          source: null,
          next: `${model}의 단가가 어디서 온 것인지 적혀 있지 않습니다 — 출처를 확인해 등록해 주세요.`,
        };
      }
      const ageDays = daysBetween(known.asOf, now);
      const stale = ageDays !== null && ageDays > PRICE_STALE_AFTER_DAYS;
      return {
        model,
        ...price,
        freshness: (stale ? "stale" : "fresh") as PriceFreshness,
        ageDays,
        asOf: known.asOf,
        source: known.source,
        next: stale
          ? `${known.asOf}에 확인한 단가입니다 (${ageDays}일 전) — 공개 요금표와 다시 대조해 주세요.`
          : null,
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model));

  const stale = rows.filter((row) => row.freshness === "stale").length;
  const unknownSource = rows.filter((row) => row.freshness === "unknown-source").length;
  const fresh = rows.length - stale - unknownSource;

  const problems: string[] = [];
  if (unknownSource > 0) {
    problems.push(`출처를 모르는 단가 ${unknownSource}건`);
  }
  if (stale > 0) {
    problems.push(`${PRICE_STALE_AFTER_DAYS}일이 지난 단가 ${stale}건`);
  }

  return {
    rows,
    fresh,
    stale,
    unknownSource,
    summary:
      problems.length === 0
        ? `가격표 ${rows.length}건 모두 출처가 적혀 있고 ${PRICE_STALE_AFTER_DAYS}일 이내에 확인된 것입니다.`
        : // 못 믿는 것을 문장 맨 앞에 — 뒤에 붙이면 앞부분만 읽힙니다.
          `${problems.join(" · ")}. 이 단가로 낸 비용은 그만큼 덜 믿을 수 있습니다 (전체 ${rows.length}건).`,
  };
}

// ── 미산정 호출 ─────────────────────────────────────────────

/** 가격표에 없는 모델로 나간 호출 한 건 */
export interface UnpricedCall {
  model: string;
  provider: string;
  feature: string;
  createdAt: string;
}

export interface UnpricedModelRow {
  model: string;
  provider: string;
  calls: number;
  /** 이 모델을 부른 기능들 — 어디를 고쳐야 하는지가 여기서 나온다 */
  features: string[];
  firstSeen: string;
  lastSeen: string;
  next: string;
}

export interface UnpricedModelReport {
  rows: UnpricedModelRow[];
  totalCalls: number;
  /** 한 줄 요약 */
  summary: string;
}

/**
 * 미산정 호출을 **모델 이름으로** 모은다 (순수 함수).
 *
 * 지금까지 미산정은 **건수**로만 보였습니다("비용이 빠진 호출 12건"). 건수는
 * 사람이 할 수 있는 일을 알려 주지 않습니다 — 무엇을 등록해야 하는지,
 * 어디서 부르고 있는지, 언제부터인지가 없기 때문입니다. 그래서 **이름 ·
 * 기능 · 처음 본 날**까지 함께 냅니다.
 *
 * 여기서 단가를 **추정하지 않습니다.** 비슷한 모델 값으로 채우면 경보는
 * 사라지지만 그 비용은 관측이 아니라 만들어낸 것이 됩니다.
 */
export function reportUnpricedModels(calls: UnpricedCall[]): UnpricedModelReport {
  const grouped = new Map<string, UnpricedCall[]>();
  for (const call of calls) {
    const key = `${call.provider}|${call.model}`;
    grouped.set(key, [...(grouped.get(key) ?? []), call]);
  }

  const rows: UnpricedModelRow[] = [...grouped.entries()]
    .map(([key, group]) => {
      const [provider, model] = key.split("|");
      const times = group.map((call) => call.createdAt).sort();
      const features = [...new Set(group.map((call) => call.feature))].sort();
      return {
        model,
        provider,
        calls: group.length,
        features,
        firstSeen: times[0],
        lastSeen: times[times.length - 1],
        next:
          `"${model}" 단가를 등록해 주세요 — 등록 전까지 이 호출들은 예산 합계에 ` +
          `들어가지 않고, 상한도 이만큼 비워 둔 채로 걸립니다.`,
      };
    })
    // 많이 불린 것부터 — 고쳐서 가장 크게 달라지는 순서
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));

  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0);

  return {
    rows,
    totalCalls,
    summary:
      rows.length === 0
        ? "가격표에 없는 모델로 나간 호출은 없습니다."
        : `가격표에 없는 모델 ${rows.length}종 · 호출 ${totalCalls}건. ` +
          `이만큼은 예산 상한이 걸리지 않은 채로 나갔습니다 — 지출 합계는 최소값입니다.`,
  };
}

/** `YYYY-MM-DD`와 지금 사이의 일수 — 읽을 수 없으면 null */
function daysBetween(asOf: string, now: number): number | null {
  const at = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.floor((now - at) / 86_400_000);
}
