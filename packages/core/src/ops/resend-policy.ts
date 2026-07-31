/**
 * 알림 재전송 정책. (TASK-4601, Sprint 46 — CTO 정책 4601-④)
 *
 * 재시도(`decideRetry`)와 재전송은 다릅니다.
 *
 * | | 재시도 | 재전송 |
 * | --- | --- | --- |
 * | 언제 | 한 번의 전송 안에서, 초 단위 | 그 전송이 완전히 끝난 뒤, 분·시간 단위 |
 * | 무엇을 고치나 | 순간적인 흔들림 | 잠깐 죽었다 살아난 채널 |
 * | 한계 | 4회 안에 끝난다 | 채널이 살아날 때까지 기다린다 |
 *
 * TASK-1401의 재시도는 4회 만에 포기하고 **그것으로 끝이었습니다.** 슬랙이
 * 5분 동안 죽어 있었다면 그 사이의 경보는 영영 전달되지 않고, 사람은 장애가
 * 있었다는 사실 자체를 모릅니다.
 *
 * ## 이 정책이 지키는 것
 *
 * 1. **재전송은 새 사실이 아닙니다.** 같은 `alertKey`로 보냅니다. 새 키를
 *    만들면 한 장애가 여러 장애로 보이고, 장애 건수가 재전송 횟수만큼
 *    부풀려집니다.
 * 2. **되돌릴 수 없는 실패는 재전송하지 않습니다**(4xx). 재시도에서 이미
 *    정한 판단을 여기서 뒤집지 않습니다 — 잘못된 URL은 4시간 뒤에도 잘못된
 *    URL입니다.
 * 3. **이미 해소된 경보는 재전송하지 않습니다.** 끝난 일로 사람을 깨우는
 *    것은 알림을 끄게 만드는 가장 빠른 길입니다.
 * 4. **상한이 있고, 상한에 닿으면 조용히 포기하지 않습니다.** 무한 재전송은
 *    죽은 채널에 영원히 매달립니다. 3회에서 멈추되 **"이 채널은 포기했다"고
 *    말합니다** — 조용히 그만두면 아무도 못 받은 알림이 없는 일이 됩니다.
 * 5. **몇 번째 재전송인지 본문에 적습니다.** 안 적으면 받는 사람은 같은
 *    알림이 세 번 온 것으로 읽고, 그러면 세 번의 장애로 착각합니다.
 */

import type { NotificationChannel, NotificationLevel } from "./notification";
import { isRetriable } from "./notification";

/** 재전송 사이의 대기 — 회차별로 벌어집니다 */
export const RESEND_BACKOFF_MS = [
  15 * 60 * 1000, // 15분
  60 * 60 * 1000, // 1시간
  4 * 60 * 60 * 1000, // 4시간
] as const;

/** 최대 재전송 횟수 (최초 전송은 포함하지 않음) */
export const RESEND_MAX_ROUNDS = RESEND_BACKOFF_MS.length;

/**
 * 이 시각이 지나면 재전송하지 않습니다.
 *
 * 하루 지난 경보를 다시 보내면 그건 알림이 아니라 기록입니다 — 그 시점에
 * 사람이 할 수 있는 일이 이미 달라져 있습니다.
 */
export const RESEND_GIVE_UP_MS = 24 * 60 * 60 * 1000;

/** 재전송 판정에 필요한 실패 기록 1건 */
export interface FailedDelivery {
  id: string;
  alertKey: string;
  channel: NotificationChannel;
  level: NotificationLevel;
  /** 마지막 시도 시각 (epoch ms) */
  lastAttemptAt: number;
  /** 최초 전송 시각 (epoch ms) */
  firstAttemptAt: number;
  /** 마지막 응답 코드 — 네트워크 오류면 null */
  status: number | null;
  /** 지금까지의 재전송 횟수 */
  rounds: number;
}

export type ResendDecision =
  /** 지금 다시 보낸다 */
  | "resend"
  /** 아직 기다린다 */
  | "wait"
  /** 다시 보내도 같은 답이 온다 */
  | "permanent"
  /** 상한에 닿았다 */
  | "exhausted"
  /** 너무 오래됐다 */
  | "stale"
  /** 그 사이에 해소됐다 */
  | "resolved";

export interface ResendPlanItem {
  delivery: FailedDelivery;
  decision: ResendDecision;
  /** `wait`이면 언제 다시 볼 것인가 (epoch ms) — 아니면 null */
  dueAt: number | null;
  /** 재전송이면 몇 번째인가 (1부터) */
  round: number | null;
  detail: string;
}

export interface ResendPlan {
  items: ResendPlanItem[];
  /** 지금 보낼 것 */
  resend: ResendPlanItem[];
  /** 포기한 것 — **조용히 사라지지 않는다** */
  givenUp: ResendPlanItem[];
  detail: string;
}

/**
 * 재전송 계획 (순수 함수).
 *
 * @param resolvedKeys 그 사이에 해소된 경보 키 — 해소된 것은 다시 보내지 않습니다.
 */
export function planResends(input: {
  failures: FailedDelivery[];
  resolvedKeys?: ReadonlySet<string>;
  now: number;
}): ResendPlan {
  const resolved = input.resolvedKeys ?? new Set<string>();
  const items = input.failures.map((delivery) => judge(delivery, resolved, input.now));

  const resend = items.filter((item) => item.decision === "resend");
  const givenUp = items.filter(
    (item) =>
      item.decision === "exhausted" ||
      item.decision === "permanent" ||
      item.decision === "stale",
  );

  const parts: string[] = [];
  if (items.length === 0) {
    parts.push("재전송 대기 중인 실패 알림이 없습니다.");
  } else {
    parts.push(`실패 알림 ${items.length}건 중 ${resend.length}건을 지금 다시 보냅니다.`);
  }
  const waiting = items.filter((item) => item.decision === "wait").length;
  if (waiting > 0) {
    parts.push(`${waiting}건은 대기 중입니다(회차마다 대기가 길어집니다).`);
  }
  if (givenUp.length > 0) {
    // 조용히 그만두면 아무도 못 받은 알림이 없는 일이 됩니다.
    parts.push(
      `${givenUp.length}건은 더 보내지 않습니다 — 받지 못한 채로 끝난 ` +
        "알림이며, 사라진 것이 아니라 여기 남아 있습니다.",
    );
  }
  const skipped = items.filter((item) => item.decision === "resolved").length;
  if (skipped > 0) {
    parts.push(`${skipped}건은 그 사이 해소돼 보내지 않습니다.`);
  }

  return { items, resend, givenUp, detail: parts.join(" ") };
}

function judge(
  delivery: FailedDelivery,
  resolvedKeys: ReadonlySet<string>,
  now: number,
): ResendPlanItem {
  const base = { delivery, dueAt: null, round: null };

  if (resolvedKeys.has(delivery.alertKey)) {
    return {
      ...base,
      decision: "resolved",
      detail:
        "그 사이에 해소돼 다시 보내지 않습니다 — 끝난 일로 사람을 깨우면 " +
        "다음 알림부터 안 읽힙니다.",
    };
  }

  // 재시도에서 이미 정한 판단을 여기서 뒤집지 않습니다.
  if (!isRetriable(delivery.status)) {
    return {
      ...base,
      decision: "permanent",
      detail:
        `HTTP ${delivery.status}는 다시 보내도 같은 답이 옵니다(잘못된 주소·인증 실패). ` +
        "설정을 고치기 전에는 이 채널로 아무것도 못 갑니다.",
    };
  }

  if (delivery.rounds >= RESEND_MAX_ROUNDS) {
    return {
      ...base,
      decision: "exhausted",
      detail:
        `재전송 ${RESEND_MAX_ROUNDS}회가 모두 실패했습니다. 더 매달리지 ` +
        "않습니다 — 다만 이 알림은 아무도 받지 못했습니다.",
    };
  }

  if (now - delivery.firstAttemptAt > RESEND_GIVE_UP_MS) {
    return {
      ...base,
      decision: "stale",
      detail:
        "최초 전송에서 하루가 지났습니다. 지금 보내면 알림이 아니라 " +
        "기록입니다 — 그때 할 수 있던 일이 이미 달라져 있습니다.",
    };
  }

  const waitMs = RESEND_BACKOFF_MS[delivery.rounds];
  const dueAt = delivery.lastAttemptAt + waitMs;
  if (now < dueAt) {
    return {
      ...base,
      decision: "wait",
      dueAt,
      detail: `${describeWait(waitMs)} 뒤에 다시 시도합니다(${delivery.rounds + 1}번째 재전송).`,
    };
  }

  return {
    delivery,
    decision: "resend",
    dueAt: null,
    round: delivery.rounds + 1,
    detail: `${delivery.rounds + 1}번째 재전송입니다.`,
  };
}

/**
 * 재전송 본문에 붙는 표시.
 *
 * **몇 번째인지 적지 않으면** 받는 사람은 같은 알림이 여러 번 온 것으로
 * 읽고, 그러면 한 장애를 여러 장애로 착각합니다.
 */
export function resendNotice(round: number, firstAttemptAt: number, now: number): string {
  return (
    `[재전송 ${round}/${RESEND_MAX_ROUNDS}] 이 알림은 ` +
    `${describeWait(now - firstAttemptAt)} 전에 보내려다 실패한 것입니다 — ` +
    "새로 생긴 문제가 아닙니다."
  );
}

function describeWait(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}분`;
  }
  return `${Math.round(minutes / 60)}시간`;
}
