/**
 * 운영 활성화 이력. (TASK-3701, Sprint 37 — CTO 정책 3701-①)
 *
 * `judgeActivation`(TASK-3601)은 **지금**에 답합니다. 그런데 전환은 하루에
 * 끝나는 일이 아니라 몇 주에 걸쳐 조건이 하나씩 채워지는 과정이고, 그 과정에서
 * 사람이 정작 알고 싶은 것은 지금 값이 아닙니다:
 *
 * - 언제부터 이 상태였나 — 어제 막힌 건가, 3주째 그대로인가
 * - 되던 것이 **되돌아간** 적이 있나 — 키가 만료되면 조건은 조용히 빠집니다
 * - 이 상태가 오래된 게 **확인해서** 오래된 건가, **아무도 안 봐서** 오래된 건가
 *
 * ## 왜 매번 적지 않는가
 *
 * `/ops/activation`은 화면을 열 때마다 불립니다. 그때마다 한 줄씩 쌓으면
 * 이력은 같은 문장 수천 줄이 되고, 그 안에서 **변화**는 보이지 않게 됩니다.
 * 그래서 상태가 바뀔 때만 새 줄을 만들고, 같은 상태를 다시 보면 기존 줄의
 * `lastSeenAt`만 갱신합니다.
 *
 * ## 그래서 조용한 것과 안 본 것을 가른다
 *
 * 변화가 없을 때만 줄이 안 늘어난다면, "3주 동안 줄이 하나"는 두 가지를
 * 뜻할 수 있습니다 — 3주 내내 확인했는데 그대로였거나, 3주 동안 아무도 안
 * 봤거나. 이 둘은 신뢰도가 전혀 다릅니다. `lastSeenAt`이 그것을 가릅니다:
 * 마지막으로 본 시각 이후 구간은 **관측되지 않은 구간**이며, 우리는 그
 * 구간을 "상태가 유지됐다"로 세지 않습니다.
 */

import type { ActivationConditionId, ActivationReport } from "./activation";

/** 이력에 남는 한 줄 — 한 줄 = 하나의 상태 구간 */
export interface ActivationHistoryEntry {
  /** 이 상태가 **처음 관측된** 시각 */
  recordedAt: Date;
  /** 이 상태를 **마지막으로 관측한** 시각 */
  lastSeenAt: Date;
  /** 이 상태로 관측된 횟수 */
  observations: number;
  activated: boolean;
  /** 상태 지문 — 같으면 같은 구간으로 본다 */
  signature: string;
  /** 그때 충족돼 있던 조건 */
  met: ActivationConditionId[];
  environment: string;
  detail: string;
}

/** 타임라인 한 칸 — 이력 한 줄에 "얼마나 · 무엇이 바뀌어" 를 더한 것 */
export interface ActivationTimelineItem extends ActivationHistoryEntry {
  /** 이 상태로 있었던 시간 (다음 기록까지, 마지막 줄이면 지금까지) */
  heldMs: number;
  /** 마지막 줄인가 — 그렇다면 `heldMs`는 최종값이 아니라 **지금까지**다 */
  ongoing: boolean;
  /**
   * 마지막 관측 이후 흐른 시간 — **아무도 보지 않은 구간**.
   * 0보다 크면 그만큼은 "상태가 유지됐다"고 말할 수 없다.
   */
  unobservedMs: number;
  /** 직전 줄 대비 새로 충족된 조건 */
  gained: ActivationConditionId[];
  /** 직전 줄 대비 **빠진** 조건 — 되돌아간 것이다 */
  lost: ActivationConditionId[];
}

export interface ActivationHistorySummary {
  timeline: ActivationTimelineItem[];
  /**
   * 마지막으로 관측된 활성화 여부 — **기록이 없으면 null**.
   * 없는 이력을 "활성화되지 않았다"로 읽지 않는다: 그것은 모르는 것이다.
   */
  activated: boolean | null;
  /** 지금 상태가 시작된 시각 */
  currentSince: Date | null;
  /** 처음으로 활성화된 시각 — 한 번도 없었으면 null */
  firstActivatedAt: Date | null;
  /** 상태가 바뀐 횟수 (첫 줄은 세지 않는다 — 변화가 아니라 시작이다) */
  changes: number;
  /** 조건이 **빠진** 적이 있는가 — 있으면 그 사실을 먼저 말한다 */
  regressions: number;
  detail: string;
}

/**
 * 상태 지문.
 *
 * 충족된 조건의 **집합**과 활성화 여부만 봅니다. 문구(`detail`)는 넣지
 * 않습니다 — 같은 상태인데 남은 시간·호스트 목록 같은 숫자가 바뀌었다는
 * 이유로 새 줄이 생기면, 다시 "변화가 안 보이는 이력"이 됩니다.
 */
export function activationSignature(report: {
  activated: boolean;
  conditions: { id: ActivationConditionId; met: boolean }[];
}): string {
  const met = report.conditions
    .filter((condition) => condition.met)
    .map((condition) => condition.id)
    .sort();
  return `${report.activated ? "on" : "off"}:${met.join(",")}`;
}

/** 이 관측이 새 줄이 되어야 하는가 — 지문이 다를 때만 */
export function shouldRecordActivation(
  previousSignature: string | null,
  report: ActivationReport,
): boolean {
  return previousSignature !== activationSignature(report);
}

const HOUR_MS = 60 * 60 * 1000;

/** 사람이 읽는 기간 — "0분"과 "모른다"를 섞지 않기 위해 항상 단위를 붙인다 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return "0분";
  }
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}시간 ${minutes % 60}분`;
  }
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}

/**
 * 이력을 타임라인으로 (순수 함수).
 *
 * `entries`는 **시간 오름차순**으로 들어옵니다. 마지막 줄의 `heldMs`는
 * 최종값이 아니라 지금까지이며, `ongoing`으로 그 사실을 표시합니다.
 */
export function summarizeActivationHistory(
  entries: ActivationHistoryEntry[],
  now: Date = new Date(),
): ActivationHistorySummary {
  if (entries.length === 0) {
    return {
      timeline: [],
      activated: null,
      currentSince: null,
      firstActivatedAt: null,
      changes: 0,
      regressions: 0,
      detail:
        "활성화 이력이 없습니다 — 아직 한 번도 판정하지 않았거나 기록이 " +
        "지워진 것입니다. 이력이 없는 것을 '활성화되지 않았다'로 읽지 않습니다.",
    };
  }

  const sorted = [...entries].sort(
    (left, right) => left.recordedAt.getTime() - right.recordedAt.getTime(),
  );

  const timeline: ActivationTimelineItem[] = sorted.map((entry, index) => {
    const next = sorted[index + 1];
    const until = next === undefined ? now.getTime() : next.recordedAt.getTime();
    const previousMet = index === 0 ? [] : sorted[index - 1].met;
    return {
      ...entry,
      heldMs: Math.max(0, until - entry.recordedAt.getTime()),
      ongoing: next === undefined,
      unobservedMs: Math.max(0, until - entry.lastSeenAt.getTime()),
      gained: entry.met.filter((id) => !previousMet.includes(id)),
      lost: previousMet.filter((id) => !entry.met.includes(id)),
    };
  });

  const current = timeline[timeline.length - 1];
  const regressions = timeline.filter((item) => item.lost.length > 0).length;
  const firstActivated = sorted.find((entry) => entry.activated) ?? null;

  const parts: string[] = [];
  parts.push(
    current.activated
      ? `활성화 상태로 ${formatDuration(current.heldMs)}째입니다.`
      : `비활성 상태로 ${formatDuration(current.heldMs)}째입니다 ` +
        `(충족 ${current.met.length}/3).`,
  );
  if (regressions > 0) {
    parts.push(
      `되돌아간 적 ${regressions}회 — 한 번 충족된 조건이 다시 빠졌습니다. ` +
        "만료된 키·닫힌 방화벽처럼 조용히 풀리는 조건이 있다는 뜻입니다.",
    );
  }
  if (current.unobservedMs > HOUR_MS) {
    parts.push(
      `마지막 확인 이후 ${formatDuration(current.unobservedMs)} 동안 아무도 ` +
        "보지 않았습니다 — 그 구간은 '그대로였다'가 아니라 '모른다'입니다.",
    );
  }

  return {
    timeline,
    activated: current.activated,
    currentSince: current.recordedAt,
    firstActivatedAt: firstActivated === null ? null : firstActivated.recordedAt,
    changes: timeline.length - 1,
    regressions,
    detail: parts.join(" "),
  };
}
