/**
 * Scheduled Governance Scan 경보. (TASK-2701, Sprint 27 — CTO 결정 2601-③)
 *
 * **위반이 늘었을 때만 부른다. 같은 결과로 반복해서 부르지 않는다.**
 *
 * 예약 스캔은 매번 도는데, 결과가 그대로인 동안 계속 경보하면 그 경보는
 * 배경 소음이 된다. **부를 일이 아닌데 부르면 정작 불러야 할 때 오지
 * 않는다**(결정 1301-① 계열). 그래서 판정 기준을 "위반이 있다"가 아니라
 * **"지난번보다 늘었다"**로 둔다.
 *
 * 줄어든 것은 부르지 않는다 — 고쳐지고 있다는 뜻이고, 좋은 일로 사람을
 * 깨울 이유가 없다. 다만 **0이 되면 해소**한다.
 *
 * 첫 스캔은 **기준선**이다. 규칙을 처음 켠 직후에는 위반이 잔뜩 있는 것이
 * 정상이고(그것을 세는 것이 Preflight의 목적이었다), 그때 전량을 경보로
 * 만들면 아무 뜻이 없다. 대신 기준선을 세웠다는 사실은 남긴다.
 */

import type { DetectedAlert } from "../ops/alerts";

/** 경보 판정에 필요한 스캔 총계 — 목록은 보지 않는다 */
export interface ScanTotals {
  /** 발행 시 막힐 것 */
  blocked: number;
  /** 이미 발행된 위반 — 막을 수 없다 */
  publishedViolations: number;
  /** 검사한 콘텐츠 수 */
  scanned: number;
}

export const GOVERNANCE_SCAN_ALERT_KEY = "governance-scan:violations";

/** 막아야 할 위반의 총합 — 주의는 세지 않는다(막지 않으므로) */
export function totalViolations(totals: ScanTotals): number {
  return totals.blocked + totals.publishedViolations;
}

export type ScanChangeVerdict =
  /** 첫 스캔 — 기준선을 세웠다 */
  | "baseline"
  /** 늘었다 — 부른다 */
  | "increased"
  /** 줄었지만 남아 있다 — 부르지 않는다 */
  | "decreased"
  /** 같다 — 부르지 않는다 */
  | "unchanged"
  /** 0이 되었다 — 해소한다 */
  | "resolved";

export interface ScanChange {
  verdict: ScanChangeVerdict;
  previous: number | null;
  current: number;
  /** 증가분 (늘지 않았으면 0) */
  delta: number;
}

/**
 * 지난 스캔과 비교한다 (순수 함수).
 *
 * `previous`가 `null`이면 첫 스캔이다. **0에서 0으로 간 것을 `resolved`로
 * 보지 않는다** — 해소는 있던 것이 없어졌을 때만이고, 없던 것이 계속 없는
 * 것은 그냥 정상이다(경보를 만들지도, 해소를 알리지도 않는다).
 */
export function compareScan(
  previous: ScanTotals | null,
  current: ScanTotals,
): ScanChange {
  const now = totalViolations(current);
  if (previous === null) {
    return { verdict: "baseline", previous: null, current: now, delta: 0 };
  }

  const before = totalViolations(previous);
  if (now > before) {
    return {
      verdict: "increased",
      previous: before,
      current: now,
      delta: now - before,
    };
  }
  if (now === 0) {
    // 있던 것이 없어졌을 때만 해소다
    return {
      verdict: before > 0 ? "resolved" : "unchanged",
      previous: before,
      current: 0,
      delta: 0,
    };
  }
  return {
    verdict: now < before ? "decreased" : "unchanged",
    previous: before,
    current: now,
    delta: 0,
  };
}

/**
 * 경보를 **동기화할 때인가** (CTO 결정 2601-③).
 *
 * 경보 저장소 동기화(`sync`)는 "이번에 감지되지 않았으면 해소"로 판단하므로,
 * 아무 때나 부르면 두 가지가 어긋난다:
 *
 * - 늘지 않은 실행에서 부르면 **경보가 없던 상태에서 새로 생긴다** —
 *   증가 없이 경보가 나가는 것이고, 결정 ③ 위반이다.
 * - 남아 있는 위반이 있는데 빈 목록으로 부르면 **"풀렸다"는 거짓 해소**가 난다.
 *
 * 그래서 **늘었을 때**(새로 알림)와 **0이 됐을 때**(해소)만 동기화한다.
 * 그 사이(같음·줄었음·첫 스캔)에는 **경보 저장소를 건드리지 않는다** —
 * 이미 있는 경보는 그대로 남고, 없으면 계속 없다.
 */
export function shouldSyncScanAlerts(change: ScanChange): boolean {
  return change.verdict === "increased" || change.verdict === "resolved";
}

/**
 * 경보 감지 (CTO 결정 2601-③).
 *
 * **늘었을 때만** 경보를 만든다. 그 외에는 빈 배열이다 — 다만 빈 배열을
 * 그대로 `sync`에 넘기면 남아 있는 위반이 해소로 처리되므로, 호출부는
 * `shouldSyncScanAlerts`로 **부를 때인지 먼저 묻는다.**
 *
 * 이미 나간 위반이 섞여 있으면 **심각**이다. 아직 막을 수 있는 것과 이미
 * 나간 것은 급한 정도가 다르다.
 */
export function detectGovernanceScanAlert(
  change: ScanChange,
  totals: ScanTotals,
  options: { scope: string },
): DetectedAlert[] {
  // 늘었을 때만 부른다. 같은 결과·줄어든 결과·첫 스캔은 경보를 만들지 않는다.
  if (change.verdict !== "increased" || change.current === 0) {
    return [];
  }

  const released = totals.publishedViolations > 0;
  const level = released ? "critical" : "warning";
  const scale =
    `발행이 막힐 것 ${totals.blocked}건` +
    (released
      ? ` · 이미 발행된 위반 ${totals.publishedViolations}건 (막을 수 없습니다 — 내려야 합니다)`
      : "");

  return [
    {
      kind: "governance-scan",
      // 범위마다 키가 다르다 — 프로젝트 하나가 나빠진 것과 전체가 나빠진
      // 것을 한 경보로 뭉치면 어디를 봐야 할지 알 수 없다
      key: `${GOVERNANCE_SCAN_ALERT_KEY}:${options.scope}`,
      level,
      title: "발행 위반이 늘었습니다",
      message:
        `위반이 ${change.previous}건에서 ${change.current}건으로 ${change.delta}건 늘었습니다. ` +
        `${scale}. 스캔은 상태를 바꾸지 않습니다 — 본문을 고치거나 규칙을 다시 판단하세요.`,
    },
  ];
}

/** 스캔 결과를 실행 이력에 남길 한 줄 — 경보를 만들지 않은 이유까지 적는다 */
export function describeScanRun(
  change: ScanChange,
  totals: ScanTotals,
): string {
  const head =
    `콘텐츠 ${totals.scanned}건 검사 · 위반 ${change.current}건` +
    (totals.publishedViolations > 0
      ? ` (이미 발행된 위반 ${totals.publishedViolations}건 포함)`
      : "");

  switch (change.verdict) {
    case "baseline":
      // 처음 켰을 때 전량을 경보로 만들면 아무 뜻이 없다
      return `${head} — 첫 스캔이므로 기준선으로 삼고 경보하지 않았습니다.`;
    case "increased":
      return `${head} — 지난번 ${change.previous}건보다 ${change.delta}건 늘어 경보했습니다.`;
    case "decreased":
      return `${head} — 지난번 ${change.previous}건보다 줄었습니다. 줄어든 것으로는 경보하지 않습니다.`;
    case "unchanged":
      return `${head} — 지난번과 같습니다. 같은 결과로 반복 경보하지 않습니다 (CTO 결정 2601-③).`;
    case "resolved":
      return `${head} — 위반이 모두 해소되었습니다.`;
  }
}
