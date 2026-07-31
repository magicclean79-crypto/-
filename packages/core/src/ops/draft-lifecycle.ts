/**
 * 장애 초안 수명 관리. (TASK-4001, Sprint 40 — CTO 정책 4001-①)
 *
 * TASK-3901은 경보에서 **초안**을 만들었습니다. 초안은 "이건 장애였을 수
 * 있습니다, 봐 주세요"라는 질문이고, 사람이 확인하거나 기각해야 끝납니다.
 *
 * 그런데 질문을 만들어 놓기만 하면 **아무도 대답하지 않는 질문이 쌓입니다.**
 * 그리고 대답 없는 질문이 서른 개 쌓이면, 목록은 읽히지 않게 되고 그때부터
 * 초안은 있으나 마나가 됩니다. 우리가 TASK-3901에서 "warning으로 초안을
 * 만들면 목록이 뒤덮인다"고 경계한 것과 **같은 실패가 시간축에서** 일어나는
 * 것입니다.
 *
 * ## 자동으로 닫지 않습니다
 *
 * 가장 쉬운 해법은 오래된 초안을 자동으로 기각하는 것입니다. 그러면 안
 * 됩니다 — **기각은 "아무것도 아니었다"는 판단**이고, 아무도 보지 않은 것을
 * 시스템이 그렇게 판단할 수는 없습니다. 그 판단을 자동으로 하면 진짜
 * 장애가 조용히 사라집니다.
 *
 * ## 대신 두 가지를 합니다
 *
 * 1. **오래된 초안을 경보로 냅니다.** 방치된 질문은 그 자체가 신호입니다 —
 *    감시가 무언가를 잡았는데 아무도 보지 않았다는 뜻이니까요.
 * 2. **아주 오래되면 만료로 표시합니다.** 만료는 기각이 **아닙니다**:
 *    기각은 "아무것도 아니었다", 만료는 **"아무도 판단하지 않았다"** 입니다.
 *    그 둘을 같은 상태로 두면, 나중에 이력을 읽는 사람이 "우리 팀은 초안을
 *    잘 기각한다"고 잘못 읽습니다. 만료는 목록에서 사라지지 않고, 그
 *    사실이 그대로 남습니다.
 */

export const DRAFT_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const DRAFT_EXPIRE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const DRAFT_STALE_KEY = "incident.draft.staleAfterDays";
export const DRAFT_EXPIRE_KEY = "incident.draft.expireAfterDays";

/** 수명 판정에 필요한 초안 한 건 */
export interface DraftAge {
  id: string;
  summary: string;
  /** 초안이 만들어진 시각 (ms) */
  createdAt: number;
  sourceAlertKey: string | null;
}

export interface DraftLifecycleReport {
  /** 오래 방치돼 경보를 낼 초안 */
  stale: DraftAge[];
  /** 만료로 표시할 초안 — **기각이 아니다** */
  expiring: DraftAge[];
  staleAfterMs: number;
  expireAfterMs: number;
  detail: string;
}

/**
 * 초안 수명을 판정한다 (순수 함수, CTO 정책 4001-①).
 *
 * **만료 대상은 경보 대상에서 뺍니다.** 만료시키면서 동시에 "봐 주세요"라고
 * 부르는 것은 앞뒤가 안 맞습니다 — 만료는 이미 "아무도 안 봤다"를 인정한
 * 것이니까요.
 */
export function judgeDraftLifecycle(input: {
  drafts: DraftAge[];
  now: number;
  staleAfterMs?: number;
  expireAfterMs?: number;
}): DraftLifecycleReport {
  const staleAfterMs = input.staleAfterMs ?? DRAFT_STALE_AFTER_MS;
  const expireAfterMs = input.expireAfterMs ?? DRAFT_EXPIRE_AFTER_MS;

  const expiring = input.drafts.filter(
    (draft) => input.now - draft.createdAt >= expireAfterMs,
  );
  const expiringIds = new Set(expiring.map((draft) => draft.id));
  const stale = input.drafts.filter(
    (draft) =>
      !expiringIds.has(draft.id) && input.now - draft.createdAt >= staleAfterMs,
  );

  const parts: string[] = [];
  if (stale.length > 0) {
    parts.push(
      `${Math.round(staleAfterMs / 86_400_000)}일 넘게 확인되지 않은 초안 ` +
        `${stale.length}건 — 감시가 무언가를 잡았는데 아무도 보지 않았다는 뜻입니다.`,
    );
  }
  if (expiring.length > 0) {
    parts.push(
      `${Math.round(expireAfterMs / 86_400_000)}일이 지나 다음 정리에서 만료로 ` +
        `표시될 초안 ${expiring.length}건 — 기각이 아니라 "아무도 판단하지 ` +
        '않았다"는 기록이며, 목록에서 사라지지 않습니다.',
    );
  }
  if (parts.length === 0) {
    parts.push("수명을 넘긴 초안이 없습니다.");
  }

  return { stale, expiring, staleAfterMs, expireAfterMs, detail: parts.join(" ") };
}

/** 방치된 초안 경보 (순수 함수) — 경보 1건으로 묶는다 */
export function detectStaleDraftAlerts(report: DraftLifecycleReport): {
  kind: "incident-draft";
  key: string;
  level: "warning";
  title: string;
  message: string;
}[] {
  if (report.stale.length === 0) {
    return [];
  }
  const days = Math.round(report.staleAfterMs / 86_400_000);
  return [
    {
      kind: "incident-draft",
      // 한 건으로 묶는다 — 초안마다 경보를 내면 초안이 쌓일 때 경보도 같이
      // 쌓이고, 그러면 우리가 막으려던 "목록이 뒤덮이는" 일이 경보에서 다시
      // 일어난다
      key: "incident-draft:stale",
      level: "warning",
      title: `확인되지 않은 장애 초안 ${report.stale.length}건`,
      message:
        `${days}일 넘게 아무도 확인하거나 기각하지 않은 초안이 ` +
        `${report.stale.length}건 있습니다: ` +
        report.stale
          .slice(0, 3)
          .map((draft) => draft.summary)
          .join(" · ") +
        (report.stale.length > 3 ? ` 외 ${report.stale.length - 3}건` : "") +
        ". 확인하면 장애가 되고, 아니면 사유와 함께 기각하세요 — " +
        "대답 없는 질문이 쌓이면 목록 자체가 읽히지 않게 됩니다.",
    },
  ];
}

/** 수명 설정 해석 (순수 함수) */
export function resolveDraftLifecycleSettings(settings: Record<string, string>): {
  staleAfterMs: number;
  expireAfterMs: number;
  rejected: { key: string; reason: string }[];
} {
  const rejected: { key: string; reason: string }[] = [];

  const read = (key: string, fallbackMs: number, min: number, max: number): number => {
    const raw = settings[key];
    if (raw === undefined) {
      return fallbackMs;
    }
    const days = Number(raw);
    if (!Number.isInteger(days) || days < min || days > max) {
      rejected.push({
        key,
        reason: `${min}~${max}일 사이의 정수여야 합니다 (받은 값: ${raw}).`,
      });
      return fallbackMs;
    }
    return days * 86_400_000;
  };

  const staleAfterMs = read(DRAFT_STALE_KEY, DRAFT_STALE_AFTER_MS, 1, 30);
  const expireAfterMs = read(DRAFT_EXPIRE_KEY, DRAFT_EXPIRE_AFTER_MS, 7, 365);

  // **만료가 경보보다 빠르면 경보는 영원히 안 납니다.** 설정 둘을 따로
  // 받으면 이 조합이 실제로 생깁니다 — 그때 조용히 이상하게 도는 것보다
  // 기본값으로 되돌리고 말하는 편이 낫습니다.
  if (expireAfterMs <= staleAfterMs) {
    rejected.push({
      key: DRAFT_EXPIRE_KEY,
      reason:
        `만료(${Math.round(expireAfterMs / 86_400_000)}일)가 경보(` +
        `${Math.round(staleAfterMs / 86_400_000)}일)보다 빠르거나 같습니다 — ` +
        "그러면 경보가 한 번도 나지 않고 초안이 바로 만료됩니다. 기본값으로 되돌립니다.",
    });
    return {
      staleAfterMs: DRAFT_STALE_AFTER_MS,
      expireAfterMs: DRAFT_EXPIRE_AFTER_MS,
      rejected,
    };
  }

  return { staleAfterMs, expireAfterMs, rejected };
}
