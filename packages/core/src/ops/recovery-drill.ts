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

/**
 * 주기와 무관하게 **즉시 추가 리허설**을 요구하는 사건 (CTO 결정 1801-⑤).
 *
 * 90일이라는 주기는 "아무것도 바뀌지 않았을 때"의 간격이다. 절차나 데이터가
 * 크게 바뀌면 **마지막 리허설이 검증한 것은 지금의 시스템이 아니다** —
 * 달력이 아니라 변경이 리허설을 부른다.
 */
export const DRILL_TRIGGERS = [
  "dr-change",
  "db-major-change",
  "pitr-adoption",
] as const;

export type DrillTrigger = (typeof DRILL_TRIGGERS)[number];

export const DRILL_TRIGGER_LABEL: Record<DrillTrigger, string> = {
  "dr-change": "재해 복구 절차 변경",
  "db-major-change": "데이터베이스 대규모 변경",
  "pitr-adoption": "PITR 도입",
};

export interface DrillRequirementInput {
  trigger: DrillTrigger;
  /** 사건이 등록된 시각 */
  createdAt: number;
  /** 이 요구를 충족한 리허설이 있는가 (api가 채운다) */
  satisfiedAt: number | null;
  /**
   * 취소된 시각 (CTO 결정 1901-②).
   * **삭제는 금지한다** — 잘못 등록한 것도 기록으로 남아야 한다.
   * 취소된 요구는 미해소로 세지 않는다.
   */
  cancelledAt?: number | null;
}

/**
 * 같은 종류의 미해소 요구가 이미 있는가 (CTO 결정 1901-⑤).
 *
 * 중복 등록을 막는 이유는 목록이 지저분해져서가 아니다 — 같은 사건이 여러 건
 * 쌓이면 **리허설 한 번으로 몇 건이 해소됐는지**가 흐려지고, 화면의 숫자가
 * 실제 상태를 말하지 못하게 된다.
 */
export function hasPendingTrigger(
  requirements: DrillRequirementInput[],
  trigger: DrillTrigger,
): boolean {
  return requirements.some(
    (entry) =>
      entry.trigger === trigger &&
      entry.satisfiedAt === null &&
      (entry.cancelledAt ?? null) === null,
  );
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
  /** 아직 리허설로 해소되지 않은 변경 사건 (CTO 결정 1801-⑤) */
  pendingTriggers: DrillTrigger[];
  /**
   * 마지막 리허설이 실패했는가 — 밀린 것과 구분한다.
   * 경보 종류를 고를 때 `detail` 문구를 읽어 추측하지 않기 위해 둔다.
   */
  lastFailed: boolean;
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
  options: {
    now: number;
    intervalMs?: number;
    graceMs?: number;
    /** 미해소 변경 사건 (CTO 결정 1801-⑤) */
    requirements?: DrillRequirementInput[];
  },
): DrillHealth {
  const intervalMs = options.intervalMs ?? DEFAULT_DRILL_INTERVAL_MS;
  const graceMs = options.graceMs ?? DEFAULT_DRILL_GRACE_MS;
  const pending = (options.requirements ?? [])
    // 취소된 요구는 미해소로 세지 않는다 (CTO 결정 1901-②)
    .filter(
      (entry) =>
        entry.satisfiedAt === null && (entry.cancelledAt ?? null) === null,
    )
    .map((entry) => entry.trigger);
  const pendingTriggers = [...new Set(pending)];

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
      pendingTriggers,
      lastFailed: false,
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
      pendingTriggers,
      lastFailed: true,
    };
  }

  const ageMs = options.now - latest.createdAt;
  const dueAt = latest.createdAt + intervalMs;
  const overdueMs = options.now - dueAt;

  // 변경 사건은 **주기보다 우선한다** (CTO 결정 1801-⑤) — 마지막 리허설이
  // 검증한 것은 변경 이전의 시스템이므로, 달력상 기한이 남았어도 유효하지 않다
  if (pendingTriggers.length > 0) {
    return {
      status: "fail",
      detail:
        `${pendingTriggers.map((trigger) => DRILL_TRIGGER_LABEL[trigger]).join("·")} 이후 ` +
        "리허설을 하지 않았습니다 — 마지막 리허설이 검증한 것은 지금의 시스템이 " +
        "아닙니다. 주기와 무관하게 즉시 수행하세요 (CTO 결정 1801-⑤).",
      ageMs,
      dueAt,
      overdueDays: Math.max(0, days(overdueMs)),
      intervalMs,
      pendingTriggers,
      lastFailed: false,
    };
  }

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
      pendingTriggers,
      lastFailed: false,
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
      pendingTriggers,
      lastFailed: false,
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
    pendingTriggers,
    lastFailed: false,
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
  // 판정과 **같은 순서**로 본다 — judge가 실패를 먼저 보는데 여기서 변경 사건을
  // 먼저 보면, 제목은 "변경 후 미수행"인데 본문은 실패 이야기가 된다.
  // 상태와 설명이 어긋나면 읽는 사람이 어느 쪽을 믿어야 할지 알 수 없다.
  if (health.lastFailed) {
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

  // 변경 사건 미해소는 별도 경보다 (CTO 결정 1801-⑤) — 달력이 아니라
  // 변경이 부른 것이므로 문구도 원인을 그대로 적는다
  if (health.pendingTriggers.length > 0) {
    return [
      {
        kind: "recovery-drill",
        key: "recovery-drill:trigger",
        level: "warning",
        title: "변경 후 복구 리허설 미수행",
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
