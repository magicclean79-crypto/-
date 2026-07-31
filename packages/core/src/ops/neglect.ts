/**
 * 연속 실패 기간과 방치 지표. (TASK-4201, Sprint 42 — CTO 정책 4201-②)
 *
 * TASK-4101의 비교는 **직전 1회**와만 했습니다. 그래서 "3주째 같은 실패"가
 * `persisting`이라는 한 단어로만 보였습니다. 그 단어는 어제 시작된 실패와
 * 석 달 된 실패를 **똑같이** 보이게 합니다.
 *
 * 그런데 이 둘은 성격이 다릅니다:
 *
 * - 어제 시작된 실패 → 아직 대응 중일 수 있습니다.
 * - **석 달 된 실패 → 아무도 대응하지 않기로 한 것**입니다. 그것을 "실패
 *   1건"으로 세는 화면은 그 사실을 감춥니다.
 *
 * ## 방치는 실패와 다른 지표입니다
 *
 * 실패 수는 나쁜 일이 몇 개인지 말하고, **방치는 그것을 얼마나 오래
 * 두었는지** 말합니다. 실패 0건인 팀과 실패 1건을 석 달 둔 팀 중 후자가 더
 * 나쁜데, 실패 수만 보면 후자가 나아 보입니다.
 *
 * ## 이 파일이 조심하는 것
 *
 * **관측이 끊긴 구간을 "괜찮았던 구간"으로 세지 않습니다.** 진단이 며칠
 * 안 돌았다면 그 사이는 나빴는지 좋았는지 모르는 것이고, 연속 실패를 그
 * 지점에서 끊으면 방치가 실제보다 짧게 보입니다. 그래서 **관측 공백을 함께
 * 적습니다.**
 */

export type NeglectStatus = "ok" | "warn" | "fail" | "unknown";

/** 시간순(오래된 것부터) 진단 실행 하나 — 항목별 상태만 */
export interface NeglectRun {
  ranAt: number;
  checks: { id: string; title: string; status: NeglectStatus }[];
}

export interface FailureStreak {
  id: string;
  title: string;
  /** 지금 상태 */
  status: NeglectStatus;
  /** 연속으로 나쁜 실행 횟수 */
  runs: number;
  /** 처음 나빠진 시각 — 창 안에서 계속 나빴으면 창의 시작일 수 있다 */
  since: number;
  /** 처음 나빠진 뒤 지난 시간 (ms) */
  durationMs: number;
  /**
   * 창의 첫 실행부터 계속 나빴는가 — 그렇다면 **실제로는 더 오래됐을 수
   * 있습니다.** "최소 N일"로 읽어야 합니다.
   */
  truncated: boolean;
  /** 사람이 읽는 기간 — 하루 미만이면 시간·분으로 적는다 */
  durationLabel: string;
  detail: string;
}

export interface NeglectReport {
  streaks: FailureStreak[];
  /** 가장 오래 방치된 항목 — 없으면 null */
  worst: FailureStreak | null;
  /** 관측한 실행 수 */
  runs: number;
  /**
   * 관측이 끊긴 가장 긴 구간 (ms) — 이 값이 크면 연속 실패가 실제보다
   * 짧게 보일 수 있습니다.
   */
  largestGapMs: number | null;
  detail: string;
}

/** 나쁜 상태인가 — `unknown`도 좋은 것이 아니다 */
function isBad(status: NeglectStatus): boolean {
  return status !== "ok";
}

function days(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/**
 * 사람이 읽는 기간 (순수 함수).
 *
 * 밖으로 내는 이유(라이브 검증에서 고침): 화면이 일수만 받아 `N일째`로
 * 찍으면 **한 시간 된 연속이 "0일째"** 가 됩니다. 설명은 "1시간째"라고
 * 말하는데 배지는 "0일째"라고 말하면, 배지와 설명이 어긋나고 사람은 둘 다
 * 안 믿습니다.
 */
export function describeDuration(ms: number): string {
  const d = days(ms);
  if (d >= 1) {
    return `${d}일`;
  }
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}시간` : `${Math.max(1, Math.floor(ms / 60_000))}분`;
}

/**
 * 연속 실패 기간을 낸다 (순수 함수, CTO 정책 4201-②).
 *
 * `runs`는 **오래된 것부터** 들어옵니다. 마지막 실행에서 나쁜 항목만
 * 대상이며, 거꾸로 훑어 언제부터 나빴는지 찾습니다.
 */
export function judgeNeglect(input: {
  runs: NeglectRun[];
  now: number;
  /** 이 기간을 넘게 나쁘면 "방치"로 본다 */
  neglectAfterMs: number;
}): NeglectReport {
  const ordered = [...input.runs].sort((a, b) => a.ranAt - b.ranAt);

  if (ordered.length === 0) {
    return {
      streaks: [],
      worst: null,
      runs: 0,
      largestGapMs: null,
      // **기록이 없는 것은 "방치가 없다"가 아니다**
      detail: "진단 기록이 없습니다 — 방치를 잴 수 없습니다.",
    };
  }

  // 관측 공백 — 이 구간은 나빴는지 좋았는지 모른다
  let largestGapMs: number | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].ranAt - ordered[index - 1].ranAt;
    if (largestGapMs === null || gap > largestGapMs) {
      largestGapMs = gap;
    }
  }

  const latest = ordered[ordered.length - 1];
  const streaks: FailureStreak[] = [];

  for (const check of latest.checks) {
    if (!isBad(check.status)) {
      continue;
    }
    let runCount = 0;
    let since = latest.ranAt;
    let truncated = true;

    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const found = ordered[index].checks.find((row) => row.id === check.id);
      if (found === undefined || !isBad(found.status)) {
        // 여기서 끊긴다 — 항목이 없었던 것도 끊긴 것으로 본다
        // (없어진 검사는 "정상이었다"가 아니지만, 연속 실패도 아니다)
        truncated = false;
        break;
      }
      runCount += 1;
      since = ordered[index].ranAt;
    }

    const durationMs = Math.max(0, input.now - since);
    const parts = [
      `${check.title}: ${runCount}회 연속 · ${describeDuration(durationMs)}째`,
    ];
    if (truncated) {
      // 창의 처음부터 나빴다 — 실제로는 더 오래됐을 수 있다
      parts.push(
        "기록이 남은 구간 내내 나빴습니다 — 실제로는 더 오래됐을 수 있으니 " +
          "최소값으로 읽으세요.",
      );
    }
    if (durationMs >= input.neglectAfterMs) {
      parts.push(
        "이 정도면 대응 중인 것이 아니라 대응하지 않기로 한 것에 가깝습니다.",
      );
    }

    streaks.push({
      id: check.id,
      title: check.title,
      status: check.status,
      runs: runCount,
      since,
      durationMs,
      truncated,
      durationLabel: describeDuration(durationMs),
      detail: parts.join(" "),
    });
  }

  streaks.sort((a, b) => b.durationMs - a.durationMs);
  const worst = streaks[0] ?? null;

  const neglected = streaks.filter((row) => row.durationMs >= input.neglectAfterMs);
  const parts: string[] = [`진단 ${ordered.length}회를 봤습니다.`];
  if (streaks.length === 0) {
    parts.push("지금 나쁜 항목이 없습니다.");
  } else {
    parts.push(
      `나쁜 항목 ${streaks.length}개 중 가장 오래된 것은 ` +
        `${worst?.title}(${describeDuration(worst?.durationMs ?? 0)}째)입니다.`,
    );
  }
  if (neglected.length > 0) {
    // **방치를 실패 수와 다른 문장으로 말한다** — 실패 1건을 석 달 둔 것은
    // 실패 3건을 어제 만든 것보다 나쁘다
    parts.push(
      `${describeDuration(input.neglectAfterMs)} 넘게 그대로인 항목 ` +
        `${neglected.length}개: ${neglected.map((row) => row.title).join(" · ")}. ` +
        "실패 수가 늘지 않았다고 나아진 것이 아닙니다.",
    );
  }
  if (largestGapMs !== null && largestGapMs > 2 * 86_400_000) {
    parts.push(
      `관측이 최대 ${describeDuration(largestGapMs)} 끊긴 구간이 있습니다 — ` +
        "그 사이는 나빴는지 좋았는지 모르므로 연속 기간이 실제보다 짧게 " +
        "보일 수 있습니다.",
    );
  }

  return {
    streaks,
    worst,
    runs: ordered.length,
    largestGapMs,
    detail: parts.join(" "),
  };
}

/**
 * 방치 경보 (순수 함수).
 *
 * **연속 실패가 시작될 때가 아니라 방치 기준을 넘을 때** 냅니다 — 시작은
 * 이미 진단 경보가 냈고(정책 4001-⑤·4101-②), 여기서 알리고 싶은 것은
 * "아직도 그대로"입니다. 그리고 **항목마다 따로 내지 않고 한 건으로
 * 묶습니다**: 방치가 여러 개라는 것 자체가 하나의 소식입니다.
 */
export function detectNeglectAlerts(
  report: NeglectReport,
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
  const neglected = report.streaks.filter(
    (row) => row.durationMs >= input.neglectAfterMs,
  );
  if (neglected.length === 0) {
    return [];
  }
  return [
    {
      kind: "diagnostics",
      key: `diagnostics:neglect:${input.tier}`,
      // 방치는 급한 소식이 아니라 **오래된** 소식이다 — critical로 울리면
      // 지금 터진 장애와 섞인다
      level: "warning",
      title: `[${input.tier}] ${describeDuration(input.neglectAfterMs)} 넘게 그대로인 항목 ${neglected.length}개`,
      message:
        neglected.map((row) => row.detail).join(" / ") +
        " 새로 나빠진 것이 아니라 계속 그런 것입니다 — 고칠 수 없다면 " +
        "그 사실을 기록하는 편이 매일 다시 보는 것보다 낫습니다.",
    },
  ];
}
