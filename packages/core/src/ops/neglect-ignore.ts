/**
 * 방치 항목의 무시·담당자·검토일. (TASK-4301, Sprint 43 — CTO 정책 4301-③)
 *
 * TASK-4201은 "이 항목이 며칠째 나쁜가"를 말하게 했습니다. 그러자 바로 다음
 * 문제가 생겼습니다: **지금 고칠 수 없는 항목이 매일 경보를 냅니다.**
 * 자격 증명이 없어 못 고치는 것, 다음 분기 계획에 잡힌 것, 외부 사정으로
 * 기다리는 것이 매일 같은 소리를 내면 **그 채널 전체가 무시됩니다.** 그러면
 * 정작 새로 나빠진 것도 안 읽힙니다.
 *
 * 그래서 "무시"가 필요합니다. 그런데 무시는 이 코드베이스에서 가장 위험한
 * 기능입니다 — **무시는 해결처럼 보이기 때문**입니다.
 *
 * ## 이 파일이 무시에 붙이는 조건
 *
 * 1. **사라지지 않습니다.** 무시해도 목록에는 그대로 있고, 배지만 붙습니다.
 *    목록에서 빼면 나중에 보는 사람은 그 항목이 **없었다고** 읽습니다.
 * 2. **시계는 계속 갑니다.** 무시해도 연속 실패 기간은 계속 늘어납니다.
 *    무시하면서 기간을 0으로 되돌리면, 무시가 곧 해결이 됩니다.
 * 3. **무기한이 없습니다.** 검토일이 반드시 있고 최대 90일입니다. 무기한
 *    무시는 "안 고치기로 했다"를 기록하지 않고 **잊는 것**입니다.
 * 4. **검토일이 지나면 자동으로 풀립니다.** 그리고 그때 경보가 **되돌아
 *    옵니다.** 이것이 이 기능이 영구 삭제로 변질되지 않는 유일한 장치입니다.
 * 5. **담당자가 필요합니다.** "팀이 결정했다"는 아무도 결정하지 않은
 *    것입니다. 이름이 없으면 검토일이 와도 아무에게도 돌아가지 않습니다.
 * 6. **사유가 필요합니다.** 항목 제목을 다시 적는 것은 사유가 아닙니다.
 *
 * ## 무시는 통계에서 빠지지 않습니다
 *
 * 요약은 "방치 3건"이라고 말하고 그 옆에 "무시 중 2건"을 적습니다.
 * **빼서 "방치 1건"이라고 말하지 않습니다** — 그러면 무시를 늘리는 것만으로
 * 지표가 좋아지고, 그건 지표를 고친 것이 아니라 눈을 가린 것입니다.
 */

import { describeDuration } from "./neglect";
import type { FailureStreak, NeglectReport } from "./neglect";

/**
 * 앞으로 남은 기간을 사람이 읽는 말로 (순수 함수).
 *
 * `describeDuration`을 그대로 쓰면 안 됩니다(라이브 검증에서 고침). 그 함수는
 * **지나간** 기간용이라 내림합니다 — "23일째"가 24일째로 보이면 안 되기
 * 때문입니다. 그런데 남은 기간에 내림을 쓰면 **사람이 20일 뒤로 정한
 * 검토일이 화면에서 "19일 뒤"** 가 됩니다. 입력한 값과 보이는 값이 어긋나면
 * 사람은 화면을 안 믿고, 안 믿는 화면은 없는 것과 같습니다.
 *
 * 그래서 남은 기간은 **가까운 쪽으로 반올림**합니다.
 */
export function describeRemaining(ms: number): string {
  if (ms <= 0) {
    return "0일";
  }
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) {
    return `${days}일`;
  }
  const hours = Math.round(ms / 3_600_000);
  return hours >= 1 ? `${hours}시간` : `${Math.max(1, Math.round(ms / 60_000))}분`;
}

/** 검토일은 이보다 멀 수 없다 — 무기한 무시는 잊는 것이다 */
export const MAX_IGNORE_DAYS = 90;

/** 사유가 이보다 짧으면 사유가 아니다 */
export const MIN_IGNORE_REASON = 10;

export interface NeglectIgnore {
  /** 이 결정의 id — 화면이 취소를 걸 수 있어야 한다 */
  id: string;
  /** 어떤 진단 항목인가 */
  checkId: string;
  /** 어느 배포 단계에서인가 — 운영에서 무시한 것이 개발까지 덮으면 안 된다 */
  tier: string;
  reason: string;
  /** 이 항목을 맡은 사람 */
  owner: string;
  /** 다시 볼 날 (ms) */
  reviewAt: number;
  decidedAt: number;
  /** 결정한 사람 (담당자와 다를 수 있다) */
  decidedBy: string;
}

export interface IgnoreVerdict {
  ok: boolean;
  reason: string;
}

/**
 * 무시 요청을 받아들일지 판정한다 (순수 함수, CTO 정책 4301-③).
 *
 * 거절할 때 **무엇이 부족한지 말합니다** — 거절만 하고 이유를 안 말하면
 * 사람은 아무 글자나 채워 넣어 통과시킵니다. 그러면 사유 칸은 있으나
 * 마나입니다.
 */
export function judgeIgnoreRequest(input: {
  reason: string;
  owner: string;
  reviewAt: number;
  now: number;
  /** 무시하려는 항목의 제목 — 사유가 이것의 반복이면 사유가 아니다 */
  title?: string;
  maxDays?: number;
}): IgnoreVerdict {
  const maxDays = input.maxDays ?? MAX_IGNORE_DAYS;
  const reason = input.reason.trim();
  const owner = input.owner.trim();

  if (owner.length === 0) {
    return {
      ok: false,
      reason:
        "담당자가 필요합니다. 팀 이름이 아니라 사람이어야 합니다 — " +
        "검토일이 왔을 때 아무에게도 돌아가지 않으면 그 무시는 영구 삭제와 " +
        "같습니다.",
    };
  }
  if (input.title !== undefined && reason === input.title.trim()) {
    return {
      ok: false,
      reason:
        "항목 제목을 다시 적은 것은 사유가 아닙니다 — 왜 지금 고치지 " +
        "않는지를 적어 주세요.",
    };
  }
  if (reason.length < MIN_IGNORE_REASON) {
    return {
      ok: false,
      reason:
        `무시하는 이유를 ${MIN_IGNORE_REASON}자 이상 적어 주세요. ` +
        "검토일에 이 글을 읽는 사람은 지금의 사정을 모릅니다.",
    };
  }
  if (input.reviewAt <= input.now) {
    return {
      ok: false,
      reason:
        "검토일은 앞날이어야 합니다. 이미 지난 날짜로 두면 무시가 " +
        "만들어지자마자 풀립니다.",
    };
  }
  const days = (input.reviewAt - input.now) / 86_400_000;
  if (days > maxDays) {
    return {
      ok: false,
      reason:
        `검토일은 최대 ${maxDays}일 뒤까지입니다. 그보다 멀면 무시가 아니라 ` +
        "잊는 것이고, 그 사이에 이 항목이 진짜 장애가 돼도 아무도 모릅니다.",
    };
  }
  return {
    ok: true,
    reason:
      `${owner}가 ${describeRemaining(input.reviewAt - input.now)} 뒤에 다시 봅니다. 그때까지 경보만 ` +
      "쉬고, 목록과 연속 기간은 그대로 갑니다 — 무시는 해결이 아닙니다.",
  };
}

/** 무시가 적용된 연속 실패 한 줄 */
export interface IgnoredStreak extends FailureStreak {
  /** 지금 무시 중인가 (검토일이 지나면 false) */
  ignored: boolean;
  /**
   * 무시 결정의 id — 없으면 null.
   *
   * 화면이 이것을 알아야 **취소할 수 있습니다**(라이브 검증에서 고침).
   * 등록만 되고 취소는 API로만 가능하면, 잘못 적은 무시가 검토일까지
   * 그대로 남습니다.
   */
  ignoreId: string | null;
  ignoreOwner: string | null;
  ignoreReason: string | null;
  ignoreReviewAt: number | null;
  /** 검토일이 지났는가 — **지났으면 무시가 아니다** */
  reviewOverdue: boolean;
  ignoreLabel: string | null;
}

export interface IgnoredNeglectReport extends Omit<NeglectReport, "streaks" | "worst"> {
  streaks: IgnoredStreak[];
  worst: IgnoredStreak | null;
  /** 지금 무시 중인 건수 — **방치 건수에서 빼지 않는다** */
  ignoredCount: number;
  /** 검토일이 지나 무시가 풀린 건수 */
  overdueCount: number;
  detail: string;
}

/**
 * 무시 결정을 방치 보고서에 얹는다 (순수 함수).
 *
 * **보고서의 숫자를 줄이지 않습니다.** 무시 중인 항목도 `streaks`에 그대로
 * 있고 기간도 그대로입니다. 바뀌는 것은 경보뿐입니다.
 */
export function applyIgnores(
  report: NeglectReport,
  ignores: NeglectIgnore[],
  input: { tier: string; now: number },
): IgnoredNeglectReport {
  const byCheck = new Map<string, NeglectIgnore>();
  for (const row of ignores) {
    // 단계가 다르면 적용하지 않는다 — 운영에서 무시한 것이 스테이징 검증까지
    // 덮으면, 검증하는 사람이 가장 늦게 안다
    if (row.tier === input.tier) {
      byCheck.set(row.checkId, row);
    }
  }

  const decorate = (streak: FailureStreak): IgnoredStreak => {
    const ignore = byCheck.get(streak.id);
    if (ignore === undefined) {
      return {
        ...streak,
        ignored: false,
        ignoreId: null,
        ignoreOwner: null,
        ignoreReason: null,
        ignoreReviewAt: null,
        reviewOverdue: false,
        ignoreLabel: null,
      };
    }
    const overdue = ignore.reviewAt <= input.now;
    return {
      ...streak,
      // 검토일이 지나면 무시가 아니다 — 이것이 이 기능이 영구 삭제로
      // 변질되지 않는 유일한 장치다
      ignored: !overdue,
      ignoreId: ignore.id,
      ignoreOwner: ignore.owner,
      ignoreReason: ignore.reason,
      ignoreReviewAt: ignore.reviewAt,
      reviewOverdue: overdue,
      ignoreLabel: overdue
        ? `검토일 지남 (${ignore.owner})`
        : `무시 중 · ${describeRemaining(ignore.reviewAt - input.now)} 뒤 검토 (${ignore.owner})`,
    };
  };

  const streaks = report.streaks.map(decorate);
  const ignoredCount = streaks.filter((row) => row.ignored).length;
  const overdueCount = streaks.filter((row) => row.reviewOverdue).length;

  const parts = [report.detail];
  if (ignoredCount > 0) {
    // **빼서 말하지 않는다** — 무시를 늘리는 것만으로 지표가 좋아지면
    // 그건 지표를 고친 것이 아니라 눈을 가린 것이다
    parts.push(
      `이 중 ${ignoredCount}건은 무시 중입니다 — 방치 건수에서 빼지 ` +
        "않았습니다. 무시는 경보를 쉬게 할 뿐 해결이 아닙니다.",
    );
  }
  if (overdueCount > 0) {
    parts.push(
      `검토일이 지난 무시 ${overdueCount}건이 있습니다 — 다시 경보 ` +
        "대상입니다. 계속 미룰 것이라면 사유를 새로 적어야 합니다.",
    );
  }

  return {
    ...report,
    streaks,
    worst: report.worst === null ? null : decorate(report.worst),
    ignoredCount,
    overdueCount,
    detail: parts.join(" "),
  };
}

/**
 * 무시를 반영한 방치 경보 (순수 함수).
 *
 * 무시 중인 항목은 빠지고, **검토일이 지난 항목은 되돌아옵니다.** 그리고
 * 검토일이 지난 것은 방치와 **다른 소식**이므로 따로 냅니다 — "아직 그대로"
 * 와 "다시 보기로 한 날이 지났다"는 받는 사람이 할 일이 다릅니다.
 */
export function detectIgnoreAwareAlerts(
  report: IgnoredNeglectReport,
  input: { tier: string; alerting: boolean; neglectAfterMs: number },
): {
  kind: "diagnostics";
  key: string;
  level: "warning" | "critical";
  title: string;
  message: string;
}[] {
  if (!input.alerting) {
    return [];
  }
  const alerts: ReturnType<typeof detectIgnoreAwareAlerts> = [];

  const active = report.streaks.filter(
    (row) => !row.ignored && row.durationMs >= input.neglectAfterMs,
  );
  if (active.length > 0) {
    alerts.push({
      kind: "diagnostics",
      key: `diagnostics:neglect:${input.tier}`,
      level: "warning",
      title: `[${input.tier}] ${describeDuration(input.neglectAfterMs)} 넘게 그대로인 항목 ${active.length}개`,
      message:
        active.map((row) => row.detail).join(" / ") +
        " 새로 나빠진 것이 아니라 계속 그런 것입니다 — 고칠 수 없다면 " +
        "사유와 담당자를 적어 검토일을 정하는 편이 매일 다시 보는 것보다 " +
        "낫습니다.",
    });
  }

  const overdue = report.streaks.filter((row) => row.reviewOverdue);
  if (overdue.length > 0) {
    alerts.push({
      kind: "diagnostics",
      key: `diagnostics:ignore-overdue:${input.tier}`,
      level: "warning",
      title: `[${input.tier}] 다시 보기로 한 날이 지난 항목 ${overdue.length}개`,
      message:
        overdue
          .map(
            (row) =>
              `${row.title}: ${row.ignoreOwner}가 보기로 했습니다 (사유: ${row.ignoreReason})`,
          )
          .join(" / ") +
        " 무시는 여기서 자동으로 풀립니다 — 계속 미루려면 사유를 새로 " +
        "적어야 하고, 그 기록이 남습니다.",
    });
  }

  return alerts;
}
