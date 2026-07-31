/**
 * 통합 운영 대시보드. (TASK-4601, Sprint 46 — CTO 정책 4601-⑤)
 *
 * 네 갈래를 한 화면에 모읍니다: **Validation · Attribution · Notification ·
 * Recovery.** 각각은 이미 화면이 있는데, 지금 운영이 어떤 상태인지 알려면
 * 넷을 따로 열어야 했고 그래서 실제로는 아무도 넷 다 보지 않았습니다.
 *
 * ## 준비 화면(4301-④)과 무엇이 다른가
 *
 * 준비 화면은 **"검증을 시작해도 되는가"** 를 봅니다 — 앞을 봅니다.
 * 이 화면은 **"지금 운영이 어떤 상태인가"** 를 봅니다 — 지금을 봅니다.
 * 둘이 겹치는 칸이 있지만 묻는 질문이 다르므로 따로 둡니다.
 *
 * ## 이 화면도 새로 판정하지 않습니다
 *
 * 4301-④·4401-⑤·4501-⑤와 같은 규칙입니다. 각 갈래는 **원본 판정을 인용**
 * 하고 `source`를 달고 다닙니다. 대시보드가 자기 점수를 계산하면 같은
 * 사실에 두 개의 답이 생기고, 어긋나는 순간 사람은 둘 다 안 믿습니다.
 *
 * ## 한 줄 요약이 못 본 것을 감추지 않습니다
 *
 * 통합 화면의 유혹은 "전체 정상"이라는 한 줄입니다. 그런데 넷 중 하나를
 * 못 읽었는데 나머지가 초록이면, 그 한 줄은 **거짓말이 됩니다.** 그래서
 * 요약은 최악값을 따르고, 못 읽은 갈래가 있으면 **그 사실을 요약 문장에
 * 먼저 적습니다.**
 */

/** 갈래의 상태 — 인용해 온 값 */
export type OverviewStatus = "ok" | "warn" | "fail" | "unknown";

export interface OverviewDomain {
  id: string;
  title: string;
  /** 이 갈래가 답하는 질문 */
  question: string;
  /** 어느 판정에서 인용하는가 */
  source: string;
}

/**
 * 네 갈래 (CTO 정책 4601-⑤).
 *
 * 순서는 **의존 순서**입니다: 검증이 안 됐으면 귀속률이 좋아도 의미가
 * 제한적이고, 알림이 안 닿으면 나머지를 봐도 사람이 못 움직이며, 복구가
 * 확인되지 않으면 앞의 셋이 다 좋아도 사고 한 번에 끝납니다.
 */
export const OVERVIEW_DOMAINS: OverviewDomain[] = [
  {
    id: "validation",
    title: "Validation",
    question: "실 Provider를 상대로 확인한 것이 있는가",
    source: "GET /ops/go-live",
  },
  {
    id: "attribution",
    title: "Attribution",
    question: "이 비용이 누구 것인지 아는가",
    source: "GET /ops/cost/attribution",
  },
  {
    id: "notification",
    title: "Notification",
    question: "장애가 나면 사람에게 닿는가",
    source: "GET /ops/notifications/health",
  },
  {
    id: "recovery",
    title: "Recovery",
    question: "잘못됐을 때 되돌릴 수 있는가",
    source: "GET /ops/drills",
  },
];

export interface OverviewTile extends OverviewDomain {
  status: OverviewStatus;
  detail: string;
  /** 지금 사람이 할 수 있는 일 — 없으면 null */
  next: string | null;
  /**
   * 이 갈래를 **읽기는 했는가** (TASK-4601 라이브에서 고침).
   *
   * `status`가 `unknown`인 이유는 둘입니다: 판정을 못 읽었거나(고칠 버그),
   * 읽었는데 판정을 유보했거나(표본 부족 같은 상태 — 트래픽이 더 필요한
   * 일). 둘 다 통과가 아니지만 **사람이 할 일이 다릅니다.** 하나로 뭉쳐
   * "읽지 못했습니다"라고 적으면, 정상으로 읽은 갈래를 못 읽었다고 말하는
   * 셈이 되고 그 문장은 화면의 칸과 어긋납니다.
   */
  read: boolean;
}

export interface OverviewReport {
  tiles: OverviewTile[];
  /** 네 갈래의 최악값 */
  status: OverviewStatus;
  /** 확실하지 않은 갈래 수 (못 읽음 + 판정 유보) */
  unknown: number;
  /** 판정 자체를 못 읽은 갈래 수 — 고칠 버그다 */
  unread: number;
  /** 읽었지만 판정을 유보한 갈래 수 — 트래픽·표본이 더 필요한 일이다 */
  undecided: number;
  detail: string;
  /** 지금 가장 먼저 할 일 — 없으면 null */
  nextAction: string | null;
}

const RANK: Record<OverviewStatus, number> = {
  ok: 0,
  // **`unknown`을 `warn`보다 낮게 두지 않습니다.** 모르는 것이 주의보다
  // 가벼우면, 못 읽은 갈래가 많은 환경이 건강해 보입니다.
  unknown: 1,
  warn: 1,
  fail: 2,
};

const STATUS_LABEL: Record<OverviewStatus, string> = {
  ok: "정상",
  warn: "주의",
  fail: "실패",
  // 세는 자리에서는 **"확실하지 않음"** 입니다. 이 한 칸에 "못 읽음"과
  // "판정 유보"가 함께 들어가므로, 둘 중 한쪽 이름으로 부르면 화면의 칸이
  // "판정 유보"라고 말하는데 요약은 "확인 못 함"이라고 말하게 됩니다 —
  // 같은 사실에 두 개의 답입니다(라이브에서 고침).
  unknown: "확실하지 않음",
};

/**
 * 통합 화면을 만든다 (순수 함수).
 *
 * `states`는 이미 있는 판정에서 가져온 값입니다. 못 가져온 갈래는
 * `unknown`이며 **통과로 세지 않습니다.**
 */
export function buildOpsOverview(input: {
  states: Record<string, { status: OverviewStatus; detail: string; next?: string | null }>;
}): OverviewReport {
  const tiles: OverviewTile[] = OVERVIEW_DOMAINS.map((domain) => {
    const found = input.states[domain.id];
    return {
      ...domain,
      status: found?.status ?? "unknown",
      detail:
        found?.detail ?? "이 갈래를 읽지 못했습니다 — 괜찮다는 뜻이 아닙니다.",
      next: found?.next ?? null,
      read: found !== undefined,
    };
  });

  const unknown = tiles.filter((tile) => tile.status === "unknown").length;
  const unread = tiles.filter((tile) => !tile.read);
  const undecided = tiles.filter((tile) => tile.read && tile.status === "unknown");
  const status = tiles.reduce<OverviewStatus>(
    (worst, tile) => (RANK[tile.status] > RANK[worst] ? tile.status : worst),
    "ok",
  );

  const parts: string[] = [];

  // **확실하지 않은 것을 먼저 말합니다.** 뒤에 붙이면 "정상 3 · 확인 못 함
  // 1"의 앞부분만 읽히고, 그 한 줄은 거짓말이 됩니다.
  //
  // 다만 **못 읽은 것과 판정을 유보한 것을 가릅니다**(라이브에서 고침).
  // 표본이 모자라 판정을 유보한 갈래를 "읽지 못했다"고 적으면, 같은 화면의
  // 칸은 "표본이 20건에 못 미쳐 판정하지 않았습니다"라고 말하는데 요약은
  // "못 읽었다"고 말합니다 — 같은 사실에 두 개의 답입니다.
  if (unread.length > 0) {
    parts.push(
      `${unread.length}개 갈래를 읽지 못했습니다(${titles(unread)}) — ` +
        "이 화면의 요약은 그만큼 덜 본 것입니다.",
    );
  }
  if (undecided.length > 0) {
    parts.push(
      `${undecided.length}개 갈래는 읽었지만 판정을 유보했습니다(${titles(undecided)}) — ` +
        "정상이라는 뜻이 아니라 아직 판단할 근거가 모자라다는 뜻입니다.",
    );
  }

  const counts = tiles.reduce<Record<OverviewStatus, number>>(
    (acc, tile) => {
      acc[tile.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0, unknown: 0 },
  );
  parts.push(
    `운영 상태 ${STATUS_LABEL[status]} — ` +
      (["fail", "warn", "unknown", "ok"] as OverviewStatus[])
        .filter((key) => counts[key] > 0)
        .map((key) => `${STATUS_LABEL[key]} ${counts[key]}`)
        .join(" · ") +
      ".",
  );

  // 가장 나쁜 갈래의 다음 할 일을 앞으로 끌어올립니다 — 네 개를 나란히
  // 보여 주면 어디부터 손대야 하는지는 여전히 사람이 골라야 합니다.
  const worstTile =
    tiles.find((tile) => tile.status === "fail" && tile.next !== null) ??
    tiles.find((tile) => tile.status !== "ok" && tile.next !== null) ??
    null;
  if (worstTile !== null) {
    parts.push(`먼저 할 일: ${worstTile.title} — ${worstTile.next}`);
  }

  return {
    tiles,
    status,
    unknown,
    unread: unread.length,
    undecided: undecided.length,
    detail: parts.join(" "),
    nextAction: worstTile?.next ?? null,
  };
}

function titles(tiles: OverviewTile[]): string {
  return tiles.map((tile) => tile.title).join(" · ");
}
