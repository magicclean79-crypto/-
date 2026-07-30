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

import type { ContentStatus } from "@acos/shared";
import type { DetectedAlert } from "../ops/alerts";
import { describeScanScope } from "./scan-scope";

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

// ── 새로 위반된 콘텐츠 (TASK-2801, CTO 결정 2701-⑤) ──────────

/**
 * 경보 문구에 담을 최대 건수 (CTO 결정 2701-⑤).
 *
 * 전부 담으면 경보가 목록이 되어 아무도 끝까지 읽지 않는다. 대신 **몇 건을
 * 생략했는지 반드시 적는다** — 조용히 자르지 않는다.
 */
export const NEW_VIOLATION_SAMPLE_LIMIT = 10;

/** 위반이 있는 콘텐츠 1건 (목록 비교·표본용) */
export interface ViolatingContent {
  contentId: string;
  title: string;
  contentStatus: ContentStatus;
}

export interface ViolationDiff {
  /**
   * 지난 실행에 없던 위반 — **총량 증가분과 다를 수 있다.**
   * 2건이 새로 생기고 1건이 해소되면 총량은 1건 늘지만 새로 위반된 것은
   * 2건이다. 둘을 같은 숫자로 말하면 문구가 거짓이 된다.
   *
   * **표본일 수 있다**(이력에서 되살릴 때). 건수는 `newlyCount`가 말한다.
   */
  newly: ViolatingContent[];
  /**
   * 새로 위반된 **전체** 수.
   *
   * `newly`를 표본으로 줄여도 이 값은 줄지 않는다 — 목록은 잘라도 숫자는
   * 사실이어야 한다.
   */
  newlyCount: number;
  /** 지난 실행에는 있었으나 이번에 사라진 위반 수 */
  resolvedCount: number;
  /**
   * 지난 목록과 비교할 수 있었는가.
   *
   * `false`면 **모르는 것**이다(첫 스캔이거나, 목록을 남기기 전의 실행과
   * 비교하는 경우). 이때 `newly`를 "0건"으로 말하면 새로 생긴 위반이 없다는
   * 뜻이 되어 사실과 어긋난다 — 문구는 "가릴 수 없다"고 말한다.
   */
  comparable: boolean;
}

/** 비교할 지난 목록이 없을 때의 결과 — 0건과 구분한다 */
export const UNCOMPARABLE_DIFF: ViolationDiff = {
  newly: [],
  newlyCount: 0,
  resolvedCount: 0,
  comparable: false,
};

/**
 * 지난 실행의 위반 목록과 이번 목록을 대조한다 (순수 함수).
 *
 * `previousIds`가 `null`이면 비교할 목록이 없다 — 첫 스캔이거나, 목록을
 * 남기기 전(TASK-2701)의 실행이다. **빈 배열과 `null`은 다르다**: 빈 배열은
 * "위반이 없었다"이고 `null`은 "무엇이 있었는지 모른다"다. 이 둘을 섞으면
 * 목록을 두기 전의 위반이 전부 "새로 생겼다"로 보고된다.
 */
export function diffViolations(
  previousIds: readonly string[] | null,
  current: readonly ViolatingContent[],
): ViolationDiff {
  if (previousIds === null) {
    return UNCOMPARABLE_DIFF;
  }
  const before = new Set(previousIds);
  const now = new Set(current.map((item) => item.contentId));
  const newly = current.filter((item) => !before.has(item.contentId));
  return {
    newly,
    newlyCount: newly.length,
    resolvedCount: [...before].filter((id) => !now.has(id)).length,
    comparable: true,
  };
}

/** 제목이 길면 잘라 쓴다 — 자른 것이 보이게 말줄임을 붙인다 */
function shortTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return "(제목 없음)";
  }
  return trimmed.length <= 30 ? trimmed : `${trimmed.slice(0, 30)}…`;
}

/**
 * 새로 위반된 콘텐츠를 문구로 (CTO 결정 2701-⑤).
 *
 * 총량만 말하는 경보는 "그래서 어디를 봐야 하나"에 답하지 않는다. 최대
 * 10건까지 제목과 id를 적고, 넘치면 **몇 건이 더 있는지와 어디서 보면
 * 되는지**를 적는다.
 */
export function describeNewViolations(diff: ViolationDiff): string {
  if (!diff.comparable) {
    return (
      "지난 실행의 위반 목록이 없어 새로 위반된 콘텐츠를 가릴 수 없습니다 " +
      "(다음 실행부터 가려집니다)."
    );
  }
  if (diff.newlyCount === 0) {
    return "새로 위반된 콘텐츠는 없습니다 (이미 있던 위반이 남아 있습니다).";
  }

  const shown = diff.newly.slice(0, NEW_VIOLATION_SAMPLE_LIMIT);
  const list = shown
    .map(
      (item) =>
        `${shortTitle(item.title)}(${item.contentId}` +
        // 이미 나간 것은 막을 수 없다 — 목록에서도 구분해 준다
        (item.contentStatus === "PUBLISHED" ? ", 이미 발행됨" : "") +
        ")",
    )
    .join(" · ");
  // 숫자는 전체를 말하고, 목록에 담지 못한 건수는 밝힌다
  const omitted = diff.newlyCount - shown.length;
  return (
    `새로 위반된 콘텐츠 ${diff.newlyCount}건` +
    (shown.length > 0 ? `: ${list}` : "") +
    "." +
    (omitted > 0
      ? ` 나머지 ${omitted}건은 문구에 담지 않았습니다 — 스캔 이력에서 보세요.`
      : "")
  );
}

/**
 * 경보 감지 (CTO 결정 2601-③ · 2701-④⑤).
 *
 * **늘었을 때만** 경보를 만든다. 그 외에는 빈 배열이다 — 다만 빈 배열을
 * 그대로 `sync`에 넘기면 남아 있는 위반이 해소로 처리되므로, 호출부는
 * `shouldSyncScanAlerts`로 **부를 때인지 먼저 묻는다.**
 *
 * 이미 나간 위반이 섞여 있으면 **심각**이다. 아직 막을 수 있는 것과 이미
 * 나간 것은 급한 정도가 다르다.
 *
 * 문구에는 **증가 수와 새로 위반된 콘텐츠**(최대 10건)를 담는다
 * (결정 2701-⑤) — 숫자만 오는 경보는 어디를 봐야 할지 알려 주지 않는다.
 */
export function detectGovernanceScanAlert(
  change: ScanChange,
  totals: ScanTotals,
  options: {
    scope: string;
    /** 범위 이름 표시용 (`{projectId: name}`) */
    projectNames?: Record<string, string>;
    /** 지난 목록과의 대조 결과 — 없으면 목록을 말하지 않는다 */
    diff?: ViolationDiff;
  },
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
  const where = describeScanScope(options.scope, options.projectNames ?? {});

  // 새로 생긴 것과 총량 증가분이 다르면 그 사실을 말한다 — 한 숫자로
  // 뭉치면 "2건이 새로 생겼는데 1건 늘었다"가 설명되지 않는다
  const composition =
    options.diff !== undefined
      ? " " +
        describeNewViolations(options.diff) +
        (options.diff.comparable && options.diff.resolvedCount > 0
          ? ` 같은 기간에 ${options.diff.resolvedCount}건은 해소되어 총량은 ${change.delta}건 늘었습니다.`
          : "")
      : "";

  return [
    {
      kind: "governance-scan",
      // 범위마다 키가 다르다 — 프로젝트 하나가 나빠진 것과 전체가 나빠진
      // 것을 한 경보로 뭉치면 어디를 봐야 할지 알 수 없다
      key: `${GOVERNANCE_SCAN_ALERT_KEY}:${options.scope}`,
      level,
      // 범위를 제목에 적는다 — 프로젝트별 경보가 여러 건 왔을 때 제목만
      // 보고 어디인지 알 수 있어야 한다 (결정 2701-④)
      title: `발행 위반이 늘었습니다 — ${where}`,
      message:
        `${where} 범위에서 위반이 ${change.previous}건에서 ${change.current}건으로 ${change.delta}건 늘었습니다. ` +
        `${scale}.${composition} ` +
        "스캔은 상태를 바꾸지 않습니다 — 본문을 고치거나 규칙을 다시 판단하세요.",
    },
  ];
}

/**
 * 스캔 결과를 실행 이력에 남길 한 줄 — 경보를 만들지 않은 이유까지 적는다.
 *
 * `diff`를 주면 **구성 변화**를 덧붙인다 (TASK-2801). 총량이 같아도 위반의
 * 구성은 바뀔 수 있고(한 건이 해소되고 다른 한 건이 생김), 그 사실이 이력에
 * 없으면 나중에 "그때 조용했는데 왜 다른 콘텐츠가 걸려 있었나"에 답할 수 없다.
 * **경보는 여전히 늘었을 때만 나간다**(결정 2601-③) — 이력에 적는 것은
 * 부르는 것이 아니다.
 */
export function describeScanRun(
  change: ScanChange,
  totals: ScanTotals,
  diff?: ViolationDiff,
): string {
  const head =
    `콘텐츠 ${totals.scanned}건 검사 · 위반 ${change.current}건` +
    (totals.publishedViolations > 0
      ? ` (이미 발행된 위반 ${totals.publishedViolations}건 포함)`
      : "");

  // 늘지 않았어도 새로 생긴 위반은 남긴다 — 부르지는 않는다
  const composition =
    diff !== undefined && diff.comparable && diff.newlyCount > 0
      ? ` 새로 위반된 콘텐츠 ${diff.newlyCount}건` +
        (diff.resolvedCount > 0 ? ` · 해소 ${diff.resolvedCount}건` : "") +
        "."
      : "";

  switch (change.verdict) {
    case "baseline":
      // 처음 켰을 때 전량을 경보로 만들면 아무 뜻이 없다
      return `${head} — 첫 스캔이므로 기준선으로 삼고 경보하지 않았습니다.`;
    case "increased":
      return `${head} — 지난번 ${change.previous}건보다 ${change.delta}건 늘어 경보했습니다.${composition}`;
    case "decreased":
      return `${head} — 지난번 ${change.previous}건보다 줄었습니다. 줄어든 것으로는 경보하지 않습니다.${composition}`;
    case "unchanged":
      return `${head} — 지난번과 같습니다. 같은 결과로 반복 경보하지 않습니다 (CTO 결정 2601-③).${composition}`;
    case "resolved":
      return `${head} — 위반이 모두 해소되었습니다.`;
  }
}
