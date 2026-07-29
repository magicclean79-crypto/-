/**
 * Backup Performance. (TASK-1901, Sprint 19 — CTO 결정 1801-①)
 *
 * 백업이 1시간마다 돌기 시작하면서(결정 1701-①) 새 질문이 생겼다:
 * **백업이 운영 DB에 부담을 주기 시작했는가.**
 *
 * `backup_runs.durationMs`는 이미 기록되고 있었다. 여기서 하는 일은 그 값에
 * **기준을 붙이는 것**뿐이다 — 관측만 하고 판정하지 않으면 아무도 보지 않는다.
 *
 * **자동으로 간격을 바꾸지 않는다** (결정 1801-①). 시스템이 스스로 백업을
 * 드물게 만들면 손실 구간이 조용히 늘어난다 — 그 판단은 사람이 해야 한다.
 */

import type { DrStatus } from "./disaster-recovery";
import type { DetectedAlert } from "./alerts";

/** 소요 시간 기준 (CTO 결정 1801-①) */
export const BACKUP_DURATION_THRESHOLDS = {
  /** 이 아래는 정상 */
  normalMs: 2_000,
  /** 이 위는 주의 */
  warningMs: 2_000,
  /** 이 위가 연속으로 이어지면 경보 */
  alertMs: 10_000,
  /** 한 번만 넘어도 심각 */
  criticalMs: 30_000,
  /** 경보를 내기까지 필요한 연속 횟수 */
  alertStreak: 3,
} as const;

export type BackupPerformanceLevel = "normal" | "warning" | "alert" | "critical";

export interface BackupDurationInput {
  ok: boolean;
  durationMs: number;
  createdAt: number;
}

export interface BackupPerformance {
  level: BackupPerformanceLevel;
  status: DrStatus;
  detail: string;
  /** 마지막 성공 백업 소요 (ms) — 없으면 null */
  latestMs: number | null;
  /** 최근 성공 백업들의 중앙값 (ms) — 없으면 null */
  medianMs: number | null;
  /** 10초를 연속으로 넘긴 횟수 (최신부터) */
  slowStreak: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${ms}ms`;
}

/**
 * 백업 소요 시간 판정 (CTO 결정 1801-①).
 *
 * | 기준 | 판정 |
 * | --- | --- |
 * | 2초 미만 | 정상 |
 * | 2~10초 | 주의 |
 * | 10초 초과가 **연속 3회** | 경보 |
 * | 30초 초과 | 심각 (한 번만 넘어도) |
 *
 * 연속 3회를 요구하는 이유는 **한 번 느린 것은 흔하기 때문**이다 — 디스크
 * 경합·다른 작업과 겹침 같은 일시적 이유로 한 번 늦었다고 경보하면 사람이
 * 경보를 무시하게 된다. 반면 30초는 한 번만 넘어도 심각으로 본다: 그 정도면
 * 일시적 경합으로 설명되지 않는다.
 *
 * **실패한 백업은 소요 시간 판정에서 제외한다** — 실패는 백업 항목이 이미
 * 잡아내고, 실패까지 걸린 시간을 성능으로 세면 판정이 흐려진다.
 */
export function judgeBackupPerformance(
  records: BackupDurationInput[],
  options: { streak?: number } = {},
): BackupPerformance {
  const streakNeeded = options.streak ?? BACKUP_DURATION_THRESHOLDS.alertStreak;
  const succeeded = [...records]
    .filter((entry) => entry.ok)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (succeeded.length === 0) {
    return {
      level: "normal",
      status: "manual",
      detail: "성공한 백업이 없어 소요 시간을 판정할 수 없습니다.",
      latestMs: null,
      medianMs: null,
      slowStreak: 0,
    };
  }

  const latest = succeeded[0];
  const medianMs = median(succeeded.map((entry) => entry.durationMs));

  let slowStreak = 0;
  for (const entry of succeeded) {
    if (entry.durationMs > BACKUP_DURATION_THRESHOLDS.alertMs) {
      slowStreak += 1;
    } else {
      break;
    }
  }

  const base = {
    latestMs: latest.durationMs,
    medianMs,
    slowStreak,
  };

  if (latest.durationMs > BACKUP_DURATION_THRESHOLDS.criticalMs) {
    return {
      ...base,
      level: "critical",
      status: "fail",
      detail:
        `마지막 백업이 ${seconds(latest.durationMs)} 걸렸습니다 — ` +
        // 조사는 앞말 받침에 따라 달라진다("30초를" / "500ms를") —
        // "보다"로 쓰면 어느 값이 와도 어긋나지 않는다
        `기준 ${seconds(BACKUP_DURATION_THRESHOLDS.criticalMs)}보다 깁니다. ` +
        "운영 DB에 부담을 주고 있을 수 있습니다. 간격을 늘릴지 판단이 필요합니다 " +
        "(자동으로 바꾸지 않습니다).",
    };
  }

  if (slowStreak >= streakNeeded) {
    return {
      ...base,
      level: "alert",
      status: "fail",
      detail:
        `백업이 ${slowStreak}회 연속으로 ${seconds(BACKUP_DURATION_THRESHOLDS.alertMs)}보다 ` +
        `길었습니다 (마지막 ${seconds(latest.durationMs)}). 일시적 경합이 아니라 ` +
        "추세로 보입니다 — 간격·데이터 크기를 검토하세요.",
    };
  }

  if (latest.durationMs > BACKUP_DURATION_THRESHOLDS.warningMs) {
    return {
      ...base,
      level: "warning",
      status: "warn",
      detail:
        `마지막 백업이 ${seconds(latest.durationMs)} 걸렸습니다 — ` +
        `기준 ${seconds(BACKUP_DURATION_THRESHOLDS.warningMs)}보다 깁니다. ` +
        "아직 조치할 수준은 아니지만 추세를 보세요.",
    };
  }

  return {
    ...base,
    level: "normal",
    status: "pass",
    detail:
      `마지막 백업 ${seconds(latest.durationMs)}` +
      (medianMs === null ? "" : ` · 최근 중앙값 ${seconds(medianMs)}`) +
      ` (기준 ${seconds(BACKUP_DURATION_THRESHOLDS.normalMs)} 미만).`,
  };
}

/**
 * 백업 성능 경보 (CTO 결정 1801-①).
 *
 * 주의(2~10초)는 **경보하지 않는다** — 화면에는 드러나되, 아직 사람을 부를
 * 일은 아니다. 부를 일이 아닌데 부르면 정작 불러야 할 때 오지 않는다.
 */
export function detectBackupPerformanceAlert(
  performance: BackupPerformance,
): DetectedAlert[] {
  if (performance.level === "critical") {
    return [
      {
        kind: "backup-performance",
        key: "backup-performance:duration",
        level: "critical",
        title: "백업 소요 시간 초과",
        message: performance.detail,
      },
    ];
  }

  if (performance.level === "alert") {
    return [
      {
        kind: "backup-performance",
        key: "backup-performance:duration",
        level: "warning",
        title: "백업이 계속 느려지고 있습니다",
        message: performance.detail,
      },
    ];
  }

  return [];
}
