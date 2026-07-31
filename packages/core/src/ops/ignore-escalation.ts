/**
 * 무시 검토일 알림과 에스컬레이션. (TASK-4401, Sprint 44 — CTO 정책 4401-③)
 *
 * TASK-4301은 무시에 검토일을 강제했고, 검토일이 지나면 자동으로 풀려
 * **경보 채널로** 돌아오게 했습니다. 그런데 그 경보는 담당자에게 가지
 * 않습니다 — 채널을 보는 사람과 그 항목을 맡은 사람이 다를 수 있고, 실제로
 * 대개 다릅니다. 그러면 "돌아온 경보"는 다시 아무도 안 보는 자리에 쌓입니다.
 *
 * ## 이 파일이 정하는 것: 언제, 누구에게, 어떤 강도로
 *
 * | 단계 | 시점 | 받는 사람 | 강도 |
 * | --- | --- | --- | --- |
 * | `due-soon` | 검토일 3일 전 | 담당자 | 알림 |
 * | `overdue` | 검토일 당일부터 | 담당자 | 주의 |
 * | `escalated` | 검토일 + 14일 | 담당자 **와 운영 채널** | 주의 |
 *
 * ## 에스컬레이션은 등급을 올리는 것이 아닙니다
 *
 * 가장 하기 쉬운 설계는 오래될수록 `warning`을 `critical`로 올리는 것입니다.
 * **그러면 안 됩니다.** 2주 전에 검토하기로 한 항목이 지금 터진 운영 장애와
 * 같은 소리로 울리면, 진짜 장애가 그 속에 묻힙니다 — 우리가 정책 4101-③에서
 * 스테이징 실패를 `warning`으로 묶어 둔 것과 같은 이유입니다.
 *
 * 그래서 **에스컬레이션은 받는 사람을 넓히는 것**입니다. 강도는 그대로 두고,
 * "담당자에게 두 번 갔는데 응답이 없다"는 사실 자체를 운영 채널에 알립니다.
 *
 * ## 알림이 무시를 연장하지 않습니다
 *
 * 알림을 보냈다고 검토일이 밀리거나 무시가 되살아나지 않습니다. 보낸 사실만
 * 기록하고, **판정은 계속 "검토일이 지났다"** 입니다. 알림이 상태를 바꾸면
 * 알림을 보내는 것만으로 문제가 사라지는 셈이 됩니다.
 */

import { describeRemaining } from "./neglect-ignore";
import type { NeglectIgnore } from "./neglect-ignore";

/** 검토일 며칠 전부터 미리 알리는가 */
export const IGNORE_DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

/** 검토일이 이만큼 지나면 운영 채널까지 넓힌다 */
export const IGNORE_ESCALATE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** 같은 단계를 이 간격 안에 다시 보내지 않는다 */
export const IGNORE_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type IgnoreNoticeStage = "due-soon" | "overdue" | "escalated";

/** 알림 이력이 붙은 무시 결정 */
export interface IgnoreWithNotice extends NeglectIgnore {
  /** 어떤 항목인가 (사람이 읽는 이름) */
  title?: string;
  /** 마지막으로 보낸 단계 — 보낸 적 없으면 null */
  lastStage: IgnoreNoticeStage | null;
  /** 마지막으로 보낸 시각 (ms) — 없으면 null */
  lastNotifiedAt: number | null;
}

export interface IgnoreNotice {
  checkId: string;
  tier: string;
  owner: string;
  stage: IgnoreNoticeStage;
  /** 담당자에게만 갈 것인가, 운영 채널까지 넓힐 것인가 */
  broadcast: boolean;
  title: string;
  message: string;
}

export interface IgnoreNoticePlan {
  notices: IgnoreNotice[];
  /** 아직 검토일이 멀어 아무것도 보내지 않은 건수 */
  quiet: number;
  /** 같은 단계를 이미 보내 건너뛴 건수 */
  suppressed: number;
  detail: string;
}

function stageOf(
  ignore: IgnoreWithNotice,
  now: number,
  options: { dueSoonMs: number; escalateAfterMs: number },
): IgnoreNoticeStage | null {
  const remaining = ignore.reviewAt - now;
  if (remaining > options.dueSoonMs) {
    return null;
  }
  if (remaining > 0) {
    return "due-soon";
  }
  return -remaining >= options.escalateAfterMs ? "escalated" : "overdue";
}

/**
 * 지금 보내야 할 알림을 정한다 (순수 함수, CTO 정책 4401-③).
 *
 * **보내는 것은 어댑터의 일입니다.** 여기서는 "무엇을 누구에게 어떤 강도로"
 * 만 정합니다 — 판정이 전송을 하면 시험에서 진짜 알림이 나갑니다.
 */
export function planIgnoreNotices(input: {
  ignores: IgnoreWithNotice[];
  now: number;
  dueSoonMs?: number;
  escalateAfterMs?: number;
  cooldownMs?: number;
}): IgnoreNoticePlan {
  const dueSoonMs = input.dueSoonMs ?? IGNORE_DUE_SOON_MS;
  const escalateAfterMs = input.escalateAfterMs ?? IGNORE_ESCALATE_AFTER_MS;
  const cooldownMs = input.cooldownMs ?? IGNORE_NOTIFY_COOLDOWN_MS;

  const notices: IgnoreNotice[] = [];
  let quiet = 0;
  let suppressed = 0;

  for (const ignore of input.ignores) {
    const stage = stageOf(ignore, input.now, { dueSoonMs, escalateAfterMs });
    if (stage === null) {
      quiet += 1;
      continue;
    }
    // 같은 단계를 하루 안에 다시 보내지 않습니다 — 매일 같은 문장이 오면
    // 그 알림부터 무시하게 되고, 그러면 검토일 자체가 의미를 잃습니다.
    // **다만 단계가 바뀌면 쿨다운과 무관하게 보냅니다**: "곧 검토일"과
    // "이미 지났다"와 "2주째 응답 없음"은 서로 다른 소식입니다.
    if (
      ignore.lastStage === stage &&
      ignore.lastNotifiedAt !== null &&
      input.now - ignore.lastNotifiedAt < cooldownMs
    ) {
      suppressed += 1;
      continue;
    }

    const name = ignore.title ?? ignore.checkId;
    const late = Math.max(0, input.now - ignore.reviewAt);

    notices.push({
      checkId: ignore.checkId,
      tier: ignore.tier,
      owner: ignore.owner,
      stage,
      // **강도를 올리지 않고 받는 사람을 넓힙니다** — 2주 된 검토 요청이
      // 지금 터진 장애와 같은 소리로 울리면 진짜 장애가 묻힙니다
      broadcast: stage === "escalated",
      title:
        stage === "due-soon"
          ? `[${ignore.tier}] ${describeRemaining(ignore.reviewAt - input.now)} 뒤 검토: ${name}`
          : stage === "overdue"
            ? `[${ignore.tier}] 검토일이 지났습니다: ${name}`
            : `[${ignore.tier}] 검토 요청에 ${describeRemaining(late)}째 응답이 없습니다: ${name}`,
      message:
        stage === "due-soon"
          ? `${ignore.owner}가 맡은 항목의 검토일이 다가옵니다. 무시 사유: ` +
            `${ignore.reason} 검토일이 지나면 무시가 자동으로 풀리고 경보가 ` +
            "돌아옵니다 — 계속 미룰 것이라면 사유를 새로 적어 주세요."
          : stage === "overdue"
            ? `${ignore.owner}가 맡은 항목의 검토일이 지났습니다. 무시는 이미 ` +
              `풀렸고 이 항목은 다시 경보 대상입니다. 무시 사유였던 것: ` +
              `${ignore.reason}`
            : `${ignore.owner}에게 검토를 요청했지만 ${describeRemaining(late)}째 ` +
              "응답이 없어 운영 채널에도 알립니다. 등급을 올리지는 않았습니다 " +
              "— 오래된 소식이 지금 터진 장애와 같은 소리로 울리면 진짜 장애가 " +
              `묻힙니다. 무시 사유였던 것: ${ignore.reason}`,
    });
  }

  const parts: string[] = [];
  if (notices.length === 0) {
    parts.push("지금 보낼 검토 알림이 없습니다.");
  } else {
    const byStage = new Map<IgnoreNoticeStage, number>();
    for (const notice of notices) {
      byStage.set(notice.stage, (byStage.get(notice.stage) ?? 0) + 1);
    }
    parts.push(
      `검토 알림 ${notices.length}건 ` +
        `(임박 ${byStage.get("due-soon") ?? 0} · 지남 ${byStage.get("overdue") ?? 0} · ` +
        `확대 ${byStage.get("escalated") ?? 0}).`,
    );
  }
  if (suppressed > 0) {
    parts.push(`같은 단계를 이미 보낸 ${suppressed}건은 건너뛰었습니다.`);
  }
  if (quiet > 0) {
    parts.push(`검토일이 아직 먼 ${quiet}건은 건드리지 않았습니다.`);
  }
  parts.push(
    "알림을 보내도 검토일이 밀리거나 무시가 되살아나지 않습니다 — 알림이 " +
      "상태를 바꾸면 보내는 것만으로 문제가 사라지는 셈이 됩니다.",
  );

  return { notices, quiet, suppressed, detail: parts.join(" ") };
}

/**
 * 알림을 경보로 (순수 함수).
 *
 * **운영 채널로 넓히는 단계만** 경보를 만듭니다. 담당자 알림까지 경보로
 * 만들면 경보 목록이 개인 할 일 목록이 되고, 그러면 아무도 경보 목록을
 * 운영 상태로 읽지 않게 됩니다.
 */
export function detectEscalationAlerts(
  plan: IgnoreNoticePlan,
  input: { alerting: boolean },
): {
  kind: "diagnostics";
  key: string;
  level: "warning";
  title: string;
  message: string;
}[] {
  if (!input.alerting) {
    return [];
  }
  return plan.notices
    .filter((notice) => notice.broadcast)
    .map((notice) => ({
      kind: "diagnostics" as const,
      key: `diagnostics:ignore-escalated:${notice.tier}:${notice.checkId}`,
      // 등급은 올리지 않습니다 (정책 4101-③과 같은 판단)
      level: "warning" as const,
      title: notice.title,
      message: notice.message,
    }));
}
