/**
 * 만료 초안 되살리기와 그 감사 기록. (TASK-4101, Sprint 41 — CTO 정책 4101-④)
 *
 * TASK-4001은 30일 넘게 아무도 안 본 초안을 **만료**로 표시했습니다. 만료는
 * 기각이 아니라 "아무도 판단하지 않았다"는 기록이고, 그래서 목록에서
 * 사라지지 않습니다.
 *
 * 그런데 되돌릴 길이 없었습니다. 실제로 필요한 두 경우가 있습니다:
 *
 * 1. **뒤늦게 진짜 장애였음이 드러난다.** 석 달 뒤 비슷한 사고가 났을 때
 *    "그때 그 초안이 이거였네"를 알게 됩니다. 그때 확인해서 장애 이력에
 *    넣을 수 있어야 합니다.
 * 2. **만료가 잘못됐다.** 휴가·이관으로 아무도 못 봤을 뿐인데 30일이
 *    지났습니다.
 *
 * ## 되살리면서 "안 늦은 것처럼" 만들지 않습니다
 *
 * 여기서 가장 쉬운 실수는 만료 표시를 **지우는 것**입니다. 그러면 목록은
 * 깨끗해지고 이력은 "확인된 장애 1건"이 됩니다. 그러면 나중에 이력을 읽는
 * 사람은 **"우리 팀은 초안을 잘 처리한다"** 고 읽습니다 — 실제로는 3주
 * 늦게 본 것인데도.
 *
 * 그래서 되살릴 때 **만료됐던 사실을 지우지 않습니다.** `expiredAt`은 그대로
 * 두고, 누가·언제·왜 되살렸는지를 따로 적습니다. 목록에는 "만료 뒤 확인됨
 * (23일 늦음)"으로 남습니다.
 *
 * ## 사유를 요구합니다
 *
 * 되살리는 것은 "이 판단을 다시 열겠다"는 선언입니다. 왜 지금 다시 보는지가
 * 없으면, 나중에 같은 질문이 또 왔을 때 앞사람의 판단을 참고할 수 없습니다.
 */

export const REVIVAL_ACTIONS = ["confirm", "dismiss", "reopen"] as const;
export type RevivalAction = (typeof REVIVAL_ACTIONS)[number];

/**
 * 조치 이름.
 *
 * "만료 뒤"를 이름에 넣지 않습니다 — `describeRevival`이 이미 "만료 23일
 * 뒤"를 앞에 붙이므로, 이름에도 넣으면 "만료 23일 뒤 만료 뒤 확인"이 됩니다
 * (라이브 검증에서 보였습니다). 얼마나 늦었는지는 앞에서 말하고, 여기서는
 * 무엇을 했는지만 말합니다.
 */
export const REVIVAL_ACTION_TITLES: Record<RevivalAction, string> = {
  /** 확인 — 장애 이력에 들어간다 */
  confirm: "확인 (초안 → 장애)",
  /** 기각 — "아무것도 아니었다"는 뒤늦은 판단 */
  dismiss: "기각",
  /** 만료 취소 — 다시 확인 대기로 (판단은 아직 안 했다) */
  reopen: "만료 취소 (다시 확인 대기)",
};

/** 되살릴 초안의 지금 상태 */
export interface ExpiredDraftState {
  status: string;
  expiredAt: number | null;
  createdAt: number;
}

export interface RevivalJudgement {
  ok: boolean;
  reason: string;
  /** 만료된 지 얼마나 지나서 손댔는가 (ms) — 만료가 아니면 null */
  latenessMs: number | null;
}

/** 사유 최소 길이 — 한두 글자는 사유가 아니다 */
const MIN_REASON_LENGTH = 5;

/**
 * 만료 초안에 대한 조치가 성립하는가 (순수 함수, CTO 정책 4101-④).
 *
 * **만료되지 않은 초안에는 쓸 수 없습니다** — 그건 기존 확인/기각 경로가
 * 하는 일이고, 두 경로가 같은 일을 하면 "만료 뒤에 손댔다"는 사실이
 * 기록에서 흐려집니다.
 */
export function judgeRevival(input: {
  draft: ExpiredDraftState;
  action: RevivalAction;
  reason: string;
  /** 확인(confirm)일 때 필요한 장애 설명 */
  summary?: string;
  now: number;
}): RevivalJudgement {
  if (input.draft.status !== "DRAFT") {
    return {
      ok: false,
      reason:
        `초안이 아닙니다 (지금 상태: ${input.draft.status}) — 이미 판단이 ` +
        "끝난 기록입니다.",
      latenessMs: null,
    };
  }
  if (input.draft.expiredAt === null) {
    return {
      ok: false,
      reason:
        "만료되지 않은 초안입니다 — 확인은 /confirm, 기각은 /dismiss를 " +
        "쓰세요. 두 경로가 같은 일을 하면 '만료 뒤에 손댔다'는 사실이 " +
        "기록에서 흐려집니다.",
      latenessMs: null,
    };
  }

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      reason:
        "사유를 적어 주세요 — 되살리는 것은 '이 판단을 다시 열겠다'는 " +
        "선언이고, 왜 지금 다시 보는지가 없으면 나중에 같은 질문이 왔을 때 " +
        "앞사람의 판단을 참고할 수 없습니다.",
      latenessMs: null,
    };
  }

  if (input.action === "confirm") {
    const summary = (input.summary ?? "").trim();
    if (summary.length < MIN_REASON_LENGTH) {
      return {
        ok: false,
        reason:
          "장애 설명을 적어 주세요 — 경보 제목을 그대로 두면 그것은 " +
          "경보의 이름이지 장애의 설명이 아닙니다.",
        latenessMs: null,
      };
    }
  }

  return {
    ok: true,
    reason: REVIVAL_ACTION_TITLES[input.action],
    latenessMs: Math.max(0, input.now - input.draft.expiredAt),
  };
}

/**
 * 되살린 뒤의 상태 (순수 함수).
 *
 * **`expiredAt`을 지우지 않습니다.** 만료됐던 사실을 지우면 목록은
 * 깨끗해지지만, 나중에 이력을 읽는 사람이 "우리 팀은 초안을 잘 처리한다"고
 * 읽습니다 — 실제로는 늦게 본 것인데도.
 *
 * 예외는 `reopen`입니다: 만료를 **취소**하는 것이 그 조치의 내용이므로
 * `expiredAt`을 비웁니다. 대신 **되살린 기록은 남습니다**(`revivedAt`) —
 * 흔적 없이 시계를 되돌리지는 않습니다.
 */
export function revivalOutcome(action: RevivalAction): {
  status: "DRAFT" | "CONFIRMED" | "DISMISSED";
  /** `expiredAt`을 비우는가 */
  clearExpiry: boolean;
} {
  switch (action) {
    case "confirm":
      return { status: "CONFIRMED", clearExpiry: false };
    case "dismiss":
      return { status: "DISMISSED", clearExpiry: false };
    case "reopen":
      return { status: "DRAFT", clearExpiry: true };
  }
}

/**
 * 목록에 붙는 한 줄 (순수 함수).
 *
 * **얼마나 늦었는지를 적습니다.** "만료 뒤 확인됨"만으로는 하루 늦은 것과
 * 석 달 늦은 것이 같아 보이고, 그러면 이 지표는 개선 대상이 되지 못합니다.
 */
export function describeRevival(input: {
  action: RevivalAction;
  latenessMs: number;
  reason: string;
}): string {
  const days = Math.floor(input.latenessMs / 86_400_000);
  const late =
    days >= 1 ? `만료 ${days}일 뒤` : "만료 당일";
  return `${late} ${REVIVAL_ACTION_TITLES[input.action]} — ${input.reason}`;
}

/** 되살림 이력 요약 (순수 함수) */
export interface RevivalRecord {
  action: RevivalAction;
  latenessMs: number;
  revivedAt: number;
}

export interface RevivalSummary {
  total: number;
  confirmed: number;
  dismissed: number;
  reopened: number;
  /** 되살린 것들의 평균 지각 — 표본이 없으면 null (0이 아니다) */
  averageLatenessMs: number | null;
  detail: string;
}

/**
 * 되살림 이력을 요약한다 (순수 함수).
 *
 * `confirmed`가 많다는 것은 **만료된 것 중 진짜 장애가 섞여 있었다**는
 * 뜻이고, 그건 수명 설정이 짧거나 아무도 초안을 안 본다는 신호입니다.
 * 이 숫자가 성과로 읽히지 않도록 그 해석을 함께 적습니다.
 */
export function summarizeRevivals(records: RevivalRecord[]): RevivalSummary {
  const confirmed = records.filter((row) => row.action === "confirm").length;
  const dismissed = records.filter((row) => row.action === "dismiss").length;
  const reopened = records.filter((row) => row.action === "reopen").length;

  const averageLatenessMs =
    records.length === 0
      ? null
      : Math.round(
          records.reduce((sum, row) => sum + row.latenessMs, 0) / records.length,
        );

  const parts: string[] = [];
  if (records.length === 0) {
    parts.push("만료된 초안을 되살린 적이 없습니다.");
  } else {
    parts.push(
      `만료 뒤 손댄 초안 ${records.length}건 (확인 ${confirmed} · 기각 ` +
        `${dismissed} · 만료 취소 ${reopened}).`,
    );
    if (averageLatenessMs !== null) {
      parts.push(`평균 ${Math.floor(averageLatenessMs / 86_400_000)}일 늦게 봤습니다.`);
    }
  }
  if (confirmed > 0) {
    // **성과로 읽히지 않게 한다** — 되살려 확인한 것이 많다는 것은 잘한 일이
    // 아니라 놓친 것이 많았다는 뜻이다
    parts.push(
      `만료된 초안 중 ${confirmed}건이 실제 장애였습니다 — 이것은 잘 처리한 ` +
        "기록이 아니라 그만큼 늦게 알았다는 기록입니다. 초안 수명이 짧거나 " +
        "아무도 초안을 보지 않고 있다는 신호일 수 있습니다.",
    );
  }

  return {
    total: records.length,
    confirmed,
    dismissed,
    reopened,
    averageLatenessMs,
    detail: parts.join(" "),
  };
}
