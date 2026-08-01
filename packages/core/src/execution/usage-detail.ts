/**
 * 토큰 사용량 상세와 정확한 비용. (TASK-4701, Sprint 47 — Reliability Expansion)
 *
 * ## 왜 지금까지의 합계가 틀렸는가
 *
 * 지금까지 우리는 호출 하나를 **두 숫자**로 셌습니다: 입력 토큰과 출력 토큰.
 * 그 둘에 단가를 곱하면 비용이 나온다고 보았고, Provider가 캐시도 추론도
 * 쓰지 않던 시절에는 맞는 계산이었습니다.
 *
 * 지금은 셋 다 틀립니다. 그리고 **틀리는 방향이 Provider마다 다릅니다**:
 *
 * | Provider | 무엇이 어긋나는가 | 방향 |
 * | --- | --- | --- |
 * | Anthropic | `input_tokens`가 캐시 토큰을 **빼고** 준다 | 실제보다 **적게** 센다 |
 * | OpenAI | `prompt_tokens`가 캐시 토큰을 **포함**하는데 캐시는 싸다 | 실제보다 **많이** 센다 |
 * | Gemini | 생각(thinking) 토큰이 `candidatesTokenCount`에 **없다** | 실제보다 **적게** 센다 |
 *
 * 세 방향이 다르므로 **합계는 어느 쪽으로도 못 믿습니다.** "대충 맞겠지"가
 * 성립하지 않는 이유입니다 — 하나는 부풀고 하나는 깎이며, 어느 쪽이 더
 * 큰지는 그날 트래픽이 정합니다.
 *
 * ## 그래서 셈의 단위를 정합니다
 *
 * Provider마다 말이 다르므로 **우리 말로 옮긴 뒤** 셉니다. 아래 네 값이
 * 우리 말이고, 어댑터가 자기 Provider의 응답을 여기로 옮깁니다.
 *
 * - `inputTokens` — **캐시를 빼고** 새로 청구되는 입력
 * - `cachedInputTokens` — 캐시에서 읽은 입력 (싸게 청구)
 * - `cacheWriteTokens` — 캐시에 쓴 입력 (비싸게 청구)
 * - `outputTokens` — **생각 토큰까지 포함한** 청구되는 출력
 *
 * ## 옛 기록을 건드리지 않습니다
 *
 * 상세가 **하나도 없으면 예전 셈 그대로**입니다. 새 셈을 과거에 소급하면
 * 지금까지의 모든 기록이 "불일치"로 뜨고(비용 기록은 Append Only입니다 —
 * 정책 3101-②), 그러면 진짜 불일치가 그 소음에 묻힙니다.
 */

/**
 * 한 호출의 토큰 상세.
 *
 * **`null`은 "그 Provider에 그 개념이 없다"**입니다 — 예를 들어 OpenAI는
 * 캐시 쓰기에 값을 매기지 않으므로 `cacheWriteTokens`가 `null`입니다.
 * "몰라서 비어 있다"와 구분하기 위해, 어댑터는 **세 칸을 모두 명시**합니다.
 */
export interface UsageDetail {
  /** 캐시에서 읽은 입력 토큰 — 있으면 싸게 청구된다 */
  cachedInputTokens: number | null;
  /** 캐시에 쓴 입력 토큰 — 있으면 비싸게 청구된다 */
  cacheWriteTokens: number | null;
  /**
   * 생각에 쓴 출력 토큰.
   *
   * **비용에는 따로 곱하지 않습니다** — 이미 `outputTokens` 안에 들어 있고
   * 출력 단가로 청구됩니다. 그래도 남기는 이유는, 본문 길이는 그대로인데
   * 비용만 세 배가 된 날 **어디로 갔는지 답할 수 있어야** 하기 때문입니다.
   */
  reasoningTokens: number | null;
}

/** 아무것도 모르는 상세 — "이 Provider는 상세를 주지 않는다" */
export const NO_USAGE_DETAIL: UsageDetail = {
  cachedInputTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
};

/**
 * 캐시에서 읽은 입력의 배율.
 *
 * 세 Provider 모두 공개 단가 기준 **기본 입력의 1/10**입니다. 배율이
 * 갈라지는 날이 오면 이 상수 하나가 아니라 Provider별 표가 되어야 하고,
 * 그 사실을 `describeUsagePricing()`이 화면에 적습니다.
 */
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * 캐시에 쓰는 입력의 배율 (Anthropic 5분 캐시 공개 단가 기준).
 *
 * **1보다 큽니다.** 캐시는 공짜로 생기지 않습니다 — 처음 한 번은 오히려
 * 비싸고, 두 번째 호출부터 이득입니다. 이 값을 1로 두면 캐시를 켠 첫날
 * 비용이 왜 늘었는지 아무도 설명하지 못합니다.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** 상세를 하나라도 아는가 */
export function hasUsageDetail(detail: UsageDetail | null | undefined): boolean {
  if (!detail) {
    return false;
  }
  return (
    detail.cachedInputTokens !== null ||
    detail.cacheWriteTokens !== null ||
    detail.reasoningTokens !== null
  );
}

/**
 * 청구 대상 입력 토큰의 합 — 캐시 읽기·쓰기까지 **개수로만** 더한 값.
 *
 * 비용이 아니라 **양**입니다. 비용은 배율이 다르므로 이 값에 단가를 곱하면
 * 안 되고, 그래서 이름에 `Billable`을 붙이지 않았습니다.
 */
export function totalInputTokens(
  usage: { inputTokens: number | null },
  detail: UsageDetail | null | undefined,
): number | null {
  if (usage.inputTokens === null) {
    return null;
  }
  if (!hasUsageDetail(detail)) {
    return usage.inputTokens;
  }
  return (
    usage.inputTokens +
    (detail?.cachedInputTokens ?? 0) +
    (detail?.cacheWriteTokens ?? 0)
  );
}

/**
 * 사람이 읽는 한 줄.
 *
 * 캐시가 걸린 호출과 안 걸린 호출을 **숫자만 보고는 구분할 수 없습니다** —
 * 캐시가 잘 걸린 날은 입력 토큰이 갑자기 줄어든 것처럼 보이고, 그것을 보고
 * "프롬프트가 짧아졌나" 하고 엉뚱한 데를 찾게 됩니다.
 */
export function describeUsage(
  usage: { inputTokens: number | null; outputTokens: number | null },
  detail: UsageDetail | null | undefined,
): string {
  if (usage.inputTokens === null || usage.outputTokens === null) {
    return "토큰을 알 수 없습니다 — 비용을 산정하지 않았습니다.";
  }

  const parts = [`입력 ${usage.inputTokens.toLocaleString()}`];
  if (detail?.cachedInputTokens !== null && detail?.cachedInputTokens !== undefined) {
    parts.push(`캐시 읽기 ${detail.cachedInputTokens.toLocaleString()}`);
  }
  if (detail?.cacheWriteTokens !== null && detail?.cacheWriteTokens !== undefined) {
    parts.push(`캐시 쓰기 ${detail.cacheWriteTokens.toLocaleString()}`);
  }
  parts.push(`출력 ${usage.outputTokens.toLocaleString()}`);
  if (detail?.reasoningTokens !== null && detail?.reasoningTokens !== undefined) {
    parts.push(`그중 생각 ${detail.reasoningTokens.toLocaleString()}`);
  }
  return `${parts.join(" · ")} 토큰`;
}

/** 배율을 화면에 그대로 보여 준다 — 숨긴 곱셈은 아무도 검산하지 못한다 */
export function describeUsagePricing(): { label: string; multiplier: number; note: string }[] {
  return [
    {
      label: "캐시에서 읽은 입력",
      multiplier: CACHE_READ_MULTIPLIER,
      note: "세 Provider 공개 단가 기준 기본 입력의 1/10 — 배율이 갈라지면 Provider별 표가 필요합니다",
    },
    {
      label: "캐시에 쓴 입력",
      multiplier: CACHE_WRITE_MULTIPLIER,
      note: "캐시는 공짜로 생기지 않습니다 — 처음 한 번은 오히려 비쌉니다",
    },
    {
      label: "생각(reasoning) 출력",
      multiplier: 1,
      note: "출력 단가 그대로입니다 — 따로 곱하지 않고 출력 토큰 안에 이미 들어 있습니다",
    },
  ];
}
