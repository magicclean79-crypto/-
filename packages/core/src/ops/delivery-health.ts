/**
 * 알림 채널 도달 건강도. (TASK-4601, Sprint 46 — CTO 정책 4601-④)
 *
 * TASK-4501의 Go-Live 판정은 "이 채널로 **한 번이라도** 성공한 기록이
 * 있는가"를 물었습니다. 그건 너무 약한 질문입니다 — 3주 전에 한 번 닿은
 * 채널과 지금 닿는 채널이 같은 초록으로 보입니다. 웹훅 주소는 조용히
 * 만료되고, 만료된 주소는 **다음 장애 때** 알게 됩니다.
 *
 * 그래서 창을 씌웁니다: **최근 24시간 안에 닿았는가.**
 *
 * ## 다만 "조용한 것"과 "죽은 것"은 다릅니다
 *
 * 24시간 동안 아무 시도도 없었다면, 그건 채널이 죽어서가 아니라 **보낼 일이
 * 없어서**일 수 있습니다. 장애가 없는 하루는 좋은 하루입니다. 그 하루를
 * "채널 실패"로 칠하면 경고가 배경 소음이 되고, 진짜로 주소가 만료된 날에
 * 아무도 안 봅니다.
 *
 * 그렇다고 통과로 세지도 않습니다. 우리는 그 채널이 지금 닿는지 **모릅니다**.
 * 모르는 것은 모른다고 적고, 확인하는 방법(`POST /ops/notifications/test`)을
 * 함께 적습니다 — 모른다는 말만 하고 방법을 안 적으면 그 칸은 영원히
 * 회색으로 남습니다.
 */

import type { NotificationChannel } from "./notification";

/** 최근 도달을 보는 창 (CTO 정책 4601-④) */
export const REACHABILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 전송 기록 1건 — 판정에 필요한 것만 */
export interface DeliveryRecord {
  channel: string;
  ok: boolean;
  /** epoch ms */
  at: number;
}

export type ReachabilityVerdict =
  /** 창 안에 성공이 있다 */
  | "reached"
  /** 창 안에 시도가 있는데 전부 실패했다 */
  | "failing"
  /** 창 안에 시도가 없다 — 죽은 것인지 조용한 것인지 **모른다** */
  | "silent"
  /** 기록 전체에 성공이 하나도 없다 */
  | "never"
  /** 주소가 없어 꺼져 있다 — 실패가 아니다 */
  | "disabled";

export interface ChannelReachability {
  channel: NotificationChannel;
  verdict: ReachabilityVerdict;
  /** 창 안의 시도 수 */
  attempts: number;
  /** 창 안의 성공 수 */
  successes: number;
  /** 마지막 성공 시각 (epoch ms) — 없으면 null */
  lastSuccessAt: number | null;
  /** 화면에 그대로 실리는 문장 */
  detail: string;
  /** 사람이 지금 할 수 있는 일 — 없으면 null */
  next: string | null;
}

/**
 * 채널 하나의 도달 건강도 (순수 함수).
 *
 * `deliveries`는 **이 채널의 기록만** 넘겨도 되고 전체를 넘겨도 됩니다 —
 * 여기서 채널로 거릅니다.
 */
export function judgeChannelReachability(input: {
  channel: NotificationChannel;
  /** 주소가 설정돼 있는가 */
  enabled: boolean;
  deliveries: DeliveryRecord[];
  now: number;
  windowMs?: number;
}): ChannelReachability {
  const windowMs = input.windowMs ?? REACHABILITY_WINDOW_MS;
  const rows = input.deliveries.filter((row) => row.channel === input.channel);
  const inWindow = rows.filter((row) => input.now - row.at <= windowMs);
  const attempts = inWindow.length;
  const successes = inWindow.filter((row) => row.ok).length;
  const lastSuccessAt = rows
    .filter((row) => row.ok)
    .reduce<number | null>(
      (best, row) => (best === null || row.at > best ? row.at : best),
      null,
    );
  const hours = Math.round(windowMs / 3_600_000);

  const base = { channel: input.channel, attempts, successes, lastSuccessAt };

  // 주소가 없는 것은 실패가 아닙니다 — 안 쓰기로 한 채널입니다.
  if (!input.enabled) {
    return {
      ...base,
      verdict: "disabled",
      detail: "주소가 설정돼 있지 않아 이 채널은 쓰지 않습니다.",
      next: null,
    };
  }

  if (successes > 0) {
    return {
      ...base,
      verdict: "reached",
      detail: `최근 ${hours}시간 안에 ${successes}건 도달했습니다.`,
      next: null,
    };
  }

  if (attempts > 0) {
    return {
      ...base,
      verdict: "failing",
      detail:
        `최근 ${hours}시간 안에 ${attempts}건을 보내려 했고 ` +
        "전부 실패했습니다. 이 채널은 지금 닿지 않습니다.",
      next: "주소와 인증을 확인하세요. 이 채널만 보는 사람은 지금 아무것도 못 받고 있습니다.",
    };
  }

  if (lastSuccessAt === null) {
    return {
      ...base,
      verdict: "never",
      detail:
        "이 채널로 도달에 성공한 기록이 한 번도 없습니다. " +
        "설정돼 있다는 것과 실제로 닿는다는 것은 다른 사실입니다.",
      next: "POST /ops/notifications/test로 한 번 보내 보세요.",
    };
  }

  // **여기가 이 판정의 핵심입니다.** 조용한 것을 실패로도, 통과로도 세지
  // 않습니다 — 우리는 지금 이 채널이 닿는지 모릅니다.
  return {
    ...base,
    verdict: "silent",
    detail:
      `최근 ${hours}시간 안에 보낸 것이 없습니다. 마지막 도달은 ` +
      `${describeAgo(input.now - lastSuccessAt)} 전입니다. ` +
      "보낼 일이 없어 조용한 것인지 주소가 죽은 것인지 가릴 수 없습니다.",
    next: "POST /ops/notifications/test로 지금 닿는지 확인하세요.",
  };
}

export interface ReachabilitySummary {
  rows: ChannelReachability[];
  /** 지금 닿는 것이 확인된 채널 수 */
  reached: number;
  /** 켜져 있는 채널 수 (판정 대상) */
  active: number;
  /** ok | warn | fail */
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * 채널 전체의 도달 상태.
 *
 * **켜진 채널이 전부 실패면 `fail`입니다** — 장애를 감지해도 아무도 못 받는
 * 상태이고, 그건 감지하지 않은 것과 같습니다.
 */
export function summarizeReachability(
  rows: ChannelReachability[],
): ReachabilitySummary {
  const active = rows.filter((row) => row.verdict !== "disabled");
  const reached = rows.filter((row) => row.verdict === "reached").length;
  const failing = rows.filter((row) => row.verdict === "failing");
  const never = rows.filter((row) => row.verdict === "never");
  const silent = rows.filter((row) => row.verdict === "silent");

  const parts: string[] = [];
  let status: "ok" | "warn" | "fail";

  if (active.length === 0) {
    status = "fail";
    parts.push(
      "켜진 알림 채널이 없습니다 — 장애를 감지해도 아무도 못 받으면 " +
        "감지하지 않은 것과 같습니다.",
    );
    return { rows, reached, active: 0, status, detail: parts.join(" ") };
  }

  parts.push(`켜진 채널 ${active.length}개 중 ${reached}개가 최근 도달했습니다.`);

  if (failing.length === active.length) {
    // 전부 실패 — 지금 이 시스템은 말을 걸 수 없습니다.
    status = "fail";
    parts.push(
      "켜진 채널이 전부 실패하고 있습니다. 지금 이 시스템은 사람에게 " +
        "말을 걸 수 없습니다.",
    );
  } else if (failing.length > 0 || never.length > 0) {
    status = "warn";
    if (failing.length > 0) {
      parts.push(`지금 닿지 않는 채널 ${failing.length}개: ${names(failing)}.`);
    }
    if (never.length > 0) {
      parts.push(`한 번도 닿은 적 없는 채널 ${never.length}개: ${names(never)}.`);
    }
  } else if (silent.length > 0) {
    // 조용한 것은 실패가 아니지만 **확인된 것도 아닙니다.**
    status = "warn";
    parts.push(
      `확인되지 않은 채널 ${silent.length}개: ${names(silent)} — ` +
        "보낼 일이 없어 조용한 것인지 죽은 것인지 가릴 수 없습니다.",
    );
  } else {
    status = "ok";
  }

  return { rows, reached, active: active.length, status, detail: parts.join(" ") };
}

function names(rows: ChannelReachability[]): string {
  return rows.map((row) => row.channel).join(" · ");
}

/** "3시간" · "2일" — 남은 기간이 아니라 지난 기간이므로 내림이 맞다 */
function describeAgo(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    return "1시간 미만";
  }
  if (hours < 48) {
    return `${hours}시간`;
  }
  return `${Math.floor(hours / 24)}일`;
}
