/**
 * Recovery Drill. (TASK-1801, Sprint 18 — CTO 결정 1701-⑤)
 *
 * **분기 1회 복구 리허설을 운영 표준으로 채택한다.**
 *
 * TASK-1601부터 체크리스트의 "복구 절차 숙지"는 `manual`로 남아 있었다.
 * 정직한 표시였지만, `manual`은 영원히 `manual`이라 **아무도 하지 않아도
 * 아무 일도 일어나지 않는다.** 리허설을 기록하면 그 항목이 비로소 판정
 * 대상이 된다 — 했으면 통과, 안 했으면 밀린 날수가 보인다.
 *
 * 판정만 순수하게 두고, 기록·경보는 api 어댑터가 한다.
 */

import type { DrStatus } from "./disaster-recovery";
import type { DetectedAlert } from "./alerts";

/** 분기 1회 = 90일 (CTO 결정 1701-⑤) */
export const DEFAULT_DRILL_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 기한을 넘긴 뒤 경보까지 두는 유예 — 하루 이틀 늦었다고 경보하면
 * 사람이 경보를 무시하게 된다.
 */
export const DEFAULT_DRILL_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export interface DrillRecordInput {
  /** 리허설이 성공했는가 — 절차대로 복구에 성공했는지 */
  ok: boolean;
  createdAt: number;
}

export interface DrillHealth {
  status: DrStatus;
  detail: string;
  /** 마지막 성공 리허설 이후 경과 (ms) — 없으면 null */
  ageMs: number | null;
  /** 다음 예정일 (epoch ms) — 이력이 없으면 null */
  dueAt: number | null;
  /** 기한을 넘긴 일수 — 넘기지 않았으면 0 */
  overdueDays: number;
  intervalMs: number;
}

function days(ms: number): number {
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * 복구 리허설 판정.
 *
 * - **이력이 없으면 `manual`** — "한 번도 안 했다"는 실패라기보다 아직
 *   시작하지 않은 상태다. 다만 통과도 아니다.
 * - 마지막 시도가 **실패**했으면 `fail`이다. 리허설의 목적은 절차가 실제로
 *   동작하는지 확인하는 것이므로, 실패한 리허설은 **절차가 깨졌다는 발견**이다.
 * - 기한을 넘기면 유예 전까지 `warn`, 유예를 넘기면 `fail`.
 */
export function judgeRecoveryDrill(
  records: DrillRecordInput[],
  options: { now: number; intervalMs?: number; graceMs?: number },
): DrillHealth {
  const intervalMs = options.intervalMs ?? DEFAULT_DRILL_INTERVAL_MS;
  const graceMs = options.graceMs ?? DEFAULT_DRILL_GRACE_MS;

  if (records.length === 0) {
    return {
      status: "manual",
      detail:
        "복구 리허설 기록이 없습니다 — 절차를 읽는 것과 해 보는 것은 다릅니다. " +
        "한 번 수행하고 결과를 남기세요.",
      ageMs: null,
      dueAt: null,
      overdueDays: 0,
      intervalMs,
    };
  }

  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const latest = sorted[0];

  if (!latest.ok) {
    return {
      status: "fail",
      detail:
        "마지막 복구 리허설이 실패했습니다 — 복구 절차가 지금 상태로는 " +
        "동작하지 않습니다. 사고가 나기 전에 고치세요.",
      ageMs: options.now - latest.createdAt,
      dueAt: latest.createdAt + intervalMs,
      overdueDays: 0,
      intervalMs,
    };
  }

  const ageMs = options.now - latest.createdAt;
  const dueAt = latest.createdAt + intervalMs;
  const overdueMs = options.now - dueAt;

  if (overdueMs > graceMs) {
    return {
      status: "fail",
      detail:
        `복구 리허설이 ${days(overdueMs)}일 밀렸습니다 — 마지막 리허설이 ` +
        `${days(ageMs)}일 전입니다. 그 사이 바뀐 절차는 검증되지 않았습니다.`,
      ageMs,
      dueAt,
      overdueDays: days(overdueMs),
      intervalMs,
    };
  }

  if (overdueMs > 0) {
    return {
      status: "warn",
      detail: `복구 리허설 기한이 ${days(overdueMs)}일 지났습니다 — 일정을 잡으세요.`,
      ageMs,
      dueAt,
      overdueDays: days(overdueMs),
      intervalMs,
    };
  }

  return {
    status: "pass",
    detail:
      `마지막 복구 리허설 ${days(ageMs)}일 전 — 다음 예정까지 ` +
      `${days(-overdueMs)}일 남았습니다.`,
    ageMs,
    dueAt,
    overdueDays: 0,
    intervalMs,
  };
}

/**
 * 리허설이 밀렸을 때의 경보 (CTO 결정 1701-⑤).
 *
 * 운영 표준으로 채택했다는 것은 **지키지 않으면 드러나야 한다**는 뜻이다.
 * 다만 심각도는 `warning`이다 — 리허설이 밀린 것은 지금 서비스가 죽는
 * 문제가 아니라, 죽었을 때 되살리지 못할 위험이 커진 것이다.
 * 리허설이 **실패**한 경우는 다르다: 절차가 깨진 것이 확인됐으므로 `critical`.
 */
export function detectDrillAlert(health: DrillHealth): DetectedAlert[] {
  if (health.status === "fail" && health.overdueDays === 0) {
    // 밀린 게 아니라 해 보니 안 되더라는 뜻
    return [
      {
        kind: "recovery-drill",
        key: "recovery-drill:failed",
        level: "critical",
        title: "복구 리허설 실패",
        message: health.detail,
      },
    ];
  }

  if (health.status === "fail" || health.status === "warn") {
    return [
      {
        kind: "recovery-drill",
        key: "recovery-drill:overdue",
        level: "warning",
        title: "복구 리허설 기한 초과",
        message: health.detail,
      },
    ];
  }

  // 이력이 없는 상태(manual)는 경보하지 않는다 — 아직 시작하지 않은 것이지
  // 규칙을 어긴 것이 아니다. 화면에는 그대로 드러난다.
  return [];
}
